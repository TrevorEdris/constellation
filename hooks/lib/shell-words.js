'use strict';
/**
 * Quote-aware shell tokenizer for the constellation guard hook.
 *
 * Why this exists: the old guards matched regexes against the raw command text, so a name
 * inside quotes, a commit message or a heredoc body looked like a command, and a command
 * hidden behind `\`, `( )` or `$( )` looked like text. This module reads a Bash command the
 * way the shell does and reports which words each simple command really has, so rules can
 * match words instead of text.
 *
 *   scan(cmd) -> { segments: Raw[], overflow: boolean }
 *
 *   Raw = {
 *     words:     string[]                          the command's words, quotes removed
 *     redirects: {op: '<'|'>'|'>>', target}[]      file redirects with their target word
 *     pipeline:  number                            shared by every `|` / `|&` member
 *     substs:    string[]                          raw bodies of $(...), `...`, <(...), >(...)
 *   }
 *
 * A segment is one simple command: the text between unquoted `; && || | |& &`, newline, `(`
 * and `)`. `{`, `}` and `!` stay ordinary words (a later layer strips them in command
 * position), so `{}`, `{a,b}` and `${X}` pass through untouched. Segments that carry no words,
 * redirects or substitutions are not reported.
 *
 * Substitution bodies are not parsed here. Each one is found by scanning to its matching `)`
 * (honoring quotes, heredocs and nested parens), stored raw in `substs`, and replaced by an
 * empty string in its word; a later layer re-parses the bodies. `$((...))` is arithmetic and
 * is skipped, though a `$(...)` nested inside it is still reported.
 *
 * scan never throws. Unterminated quotes, substitutions and heredocs close at end of input.
 * Substitutions nested more than MAX_NEST deep are not followed: the rest of the input becomes
 * that body and `overflow` is set so the caller can treat the command as unparsed.
 *
 * Known gaps, kept out on purpose: `${...}` is not parsed as a unit (so `${X:-a b}` splits on
 * the space), and `((...))` at the start of a command is read as two subshell parens.
 */

const MAX_NEST = 16;

function scan(cmd) {
  const src = typeof cmd === 'string' ? cmd : '';
  const state = { overflow: false };
  const { segments } = run(src, 0, 0, false, state);
  // run keeps a heredoc's segment alive until the body is read; drop it if nothing attached.
  return {
    segments: segments.filter((s) => s.words.length || s.redirects.length || s.substs.length),
    overflow: state.overflow,
  };
}

/**
 * Tokenize src from `start`. With `untilParen`, stop at the unmatched `)` that closes a
 * substitution and report its index as `end` (src.length when it never closes); otherwise run
 * to the end of input. `depth` is the nesting level of this text (0 at top level).
 */
function run(src, start, depth, untilParen, st) {
  const n = src.length;
  const segments = [];
  const heredocs = []; // heredocs whose body starts after the next newline
  let i = start;
  let pipeline = 0;
  let parens = 0;
  let seg = { words: [], redirects: [], pipeline, substs: [] };
  let keepSeg = false; // an unquoted heredoc may still attach substs to an otherwise empty segment
  // The word being built. `inWord` is separate from `cur` so that '' and $(...) are real words.
  let cur = '';
  let inWord = false;
  let quoted = false; // any quoting seen in this word: decides a heredoc delimiter's kind
  // What the next completed word is for after a redirect operator: {kind:'redir',op},
  // {kind:'dup',op} (>&WORD, <&WORD), {kind:'heredoc',strip} or {kind:'skip'} (<<<).
  let pending = null;

  const addSubst = (body) => { seg.substs.push(body); };

  function flushWord() {
    if (inWord) {
      const p = pending;
      pending = null;
      if (!p) {
        seg.words.push(cur);
      } else if (p.kind === 'redir') {
        seg.redirects.push({ op: p.op, target: cur });
      } else if (p.kind === 'dup') {
        // >&2, 2>&1, <&0 and >&- duplicate or close a descriptor. >&file writes to the file.
        if (p.op === '>' && !/^(\d+-?|-)$/.test(cur)) seg.redirects.push({ op: '>', target: cur });
      } else if (p.kind === 'heredoc') {
        heredocs.push({ delim: cur, quoted, strip: p.strip, owner: seg });
        if (!quoted) keepSeg = true;
      }
    }
    cur = '';
    inWord = false;
    quoted = false;
  }

  function endSegment(samePipeline) {
    flushWord();
    pending = null;
    if (seg.words.length || seg.redirects.length || seg.substs.length || keepSeg) segments.push(seg);
    if (!samePipeline) pipeline++;
    seg = { words: [], redirects: [], pipeline, substs: [] };
    keepSeg = false;
  }

  // Read the bodies of every pending heredoc, in order, starting at `pos` (just after a
  // newline). A body ends at a line equal to its delimiter, or at end of input. Quoted
  // delimiters make the body literal and it is dropped; otherwise only its $(...) and
  // backticks matter.
  function readHeredocBodies(pos) {
    while (heredocs.length) {
      const h = heredocs.shift();
      const bodyStart = pos;
      let lineEnd = n;
      let found = false;
      while (pos < n) {
        const nl = src.indexOf('\n', pos);
        lineEnd = nl === -1 ? n : nl;
        const line = h.strip ? src.slice(pos, lineEnd).replace(/^\t+/, '') : src.slice(pos, lineEnd);
        if (line === h.delim) { found = true; break; }
        pos = lineEnd + 1;
      }
      const bodyEnd = found ? pos : n;
      if (!h.quoted) {
        dqText(src.slice(bodyStart, bodyEnd), 0, false, depth, st, (body) => { h.owner.substs.push(body); });
      }
      pos = found ? Math.min(lineEnd + 1, n) : n;
    }
    return pos;
  }

  while (i < n) {
    const c = src[i];

    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; } // line join: vanishes, even mid-word
      if (i + 1 >= n) { cur += c; inWord = true; i++; continue; }
      cur += src[i + 1];
      inWord = true;
      quoted = true;
      i += 2;
      continue;
    }

    if (c === "'") {
      const close = src.indexOf("'", i + 1);
      const end = close === -1 ? n : close;
      cur += src.slice(i + 1, end);
      inWord = true;
      quoted = true;
      i = close === -1 ? n : close + 1;
      continue;
    }

    if (c === '"') {
      const r = dqText(src, i + 1, true, depth, st, addSubst);
      cur += r.text;
      inWord = true;
      quoted = true;
      i = r.end;
      continue;
    }

    if (c === '$' || c === '`') {
      const e = expansion(src, i, depth, st, addSubst);
      if (e !== -1) { inWord = true; i = e; continue; }
      if (src[i + 1] === "'") {
        // $'...' is ANSI-C quoting: unlike '...', a backslash can escape the closing quote.
        let j = i + 2;
        let out = '';
        while (j < n && src[j] !== "'") {
          if (src[j] === '\\' && j + 1 < n) {
            const d = src[j + 1];
            out += d === "'" || d === '\\' || d === '"' ? d : '\\' + d;
            j += 2;
          } else {
            out += src[j++];
          }
        }
        cur += out;
        inWord = true;
        quoted = true;
        i = Math.min(j + 1, n);
        continue;
      }
      if (src[i + 1] === '"') { i++; continue; } // $"..." is a plain double-quoted string
      cur += c;
      inWord = true;
      i++;
      continue;
    }

    if (c === ' ' || c === '\t') { flushWord(); i++; continue; }

    if (c === '\n') {
      endSegment(false);
      i = readHeredocBodies(i + 1);
      continue;
    }

    if (c === '#' && !inWord) {
      // A comment runs to end of line; an apostrophe inside it must not open a quote.
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }

    if (c === ';') { endSegment(false); i++; continue; }

    if (c === '&') {
      if (src[i + 1] === '&') { endSegment(false); i += 2; continue; }
      if (src[i + 1] === '>') {
        flushWord();
        const append = src[i + 2] === '>';
        pending = { kind: 'redir', op: append ? '>>' : '>' };
        i += append ? 3 : 2;
        continue;
      }
      endSegment(false);
      i++;
      continue;
    }

    if (c === '|') {
      if (src[i + 1] === '|') { endSegment(false); i += 2; continue; }
      endSegment(true);
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }

    if (c === '(') { endSegment(false); parens++; i++; continue; }

    if (c === ')') {
      if (untilParen && parens === 0) {
        endSegment(false);
        return { segments, end: i };
      }
      endSegment(false);
      if (parens > 0) parens--;
      i++;
      continue;
    }

    if (c === '<' || c === '>') {
      if (src[i + 1] === '(') {
        // Process substitution <(...) / >(...) joins the current word like $(...) does.
        i = substitution(src, i + 2, depth, st, addSubst);
        inWord = true;
        continue;
      }
      // In `2>file` the digits are a descriptor, not an argument. `a2>file` keeps `a2`.
      if (inWord && !quoted && !pending && /^\d+$/.test(cur)) {
        cur = '';
        inWord = false;
      } else {
        flushWord();
      }
      const next = src[i + 1];
      if (c === '>') {
        if (next === '>') { pending = { kind: 'redir', op: '>>' }; i += 2; }
        else if (next === '&') { pending = { kind: 'dup', op: '>' }; i += 2; }
        else if (next === '|') { pending = { kind: 'redir', op: '>' }; i += 2; }
        else { pending = { kind: 'redir', op: '>' }; i++; }
      } else if (next === '<') {
        if (src[i + 2] === '<') {
          pending = { kind: 'skip' }; // here-string: its word is data, not a target
          i += 3;
        } else {
          const strip = src[i + 2] === '-';
          pending = { kind: 'heredoc', strip };
          i += strip ? 3 : 2;
        }
      } else if (next === '>') { pending = { kind: 'redir', op: '>' }; i += 2; } // <> opens read/write
      else if (next === '&') { pending = { kind: 'dup', op: '<' }; i += 2; }
      else { pending = { kind: 'redir', op: '<' }; i++; }
      continue;
    }

    cur += c;
    inWord = true;
    i++;
  }

  endSegment(false);
  return { segments, end: n };
}

/**
 * Scan the text of a double-quoted string starting at `i`. Backslash escapes only `$`, a
 * backtick, `"`, `\` and newline; `$(...)` and backticks stay live. Returns the string's
 * literal text (substitutions contribute nothing) and the index after it. With `stopAtQuote`
 * the string ends at the next unescaped `"`; without it the text runs to its end, which is how
 * an unquoted heredoc body is read.
 */
function dqText(text, i, stopAtQuote, depth, st, addSubst) {
  const n = text.length;
  let out = '';
  while (i < n) {
    const c = text[i];
    if (stopAtQuote && c === '"') return { text: out, end: i + 1 };
    if (c === '\\') {
      const d = text[i + 1];
      if (d === '\n') { i += 2; continue; }
      if (d === '$' || d === '`' || d === '"' || d === '\\') { out += d; i += 2; continue; }
      out += c;
      i++;
      continue;
    }
    if (c === '$' || c === '`') {
      const e = expansion(text, i, depth, st, addSubst);
      if (e !== -1) { i = e; continue; }
    }
    out += c;
    i++;
  }
  return { text: out, end: n };
}

/**
 * If a `$(...)`, `$((...))` or backtick expansion starts at src[i], consume it and return the
 * index after it. Command-substitution bodies go to addSubst. Returns -1 when none starts here.
 */
function expansion(src, i, depth, st, addSubst) {
  if (src[i] === '`') return backtick(src, i + 1, addSubst);
  if (src[i] === '$' && src[i + 1] === '(') {
    return src[i + 2] === '('
      ? arithmetic(src, i + 3, depth, st, addSubst)
      : substitution(src, i + 2, depth, st, addSubst);
  }
  return -1;
}

/**
 * Consume a command substitution whose body starts at `i` (just after `$(`, `<(` or `>(`).
 * Finding the closing `)` means tokenizing the body, so quotes, heredocs and nested parens
 * inside it are honored. Returns the index after the `)`.
 */
function substitution(src, i, depth, st, addSubst) {
  if (depth + 1 > MAX_NEST) {
    st.overflow = true;
    addSubst(src.slice(i));
    return src.length;
  }
  const end = run(src, i, depth + 1, true, st).end;
  addSubst(src.slice(i, end));
  return Math.min(end + 1, src.length);
}

/**
 * Consume a backtick substitution whose body starts at `i`. The body ends at the next
 * unescaped backtick; inside it a backslash only escapes a backtick, `$` or another backslash,
 * and those escapes are removed so a nested backtick pair is plain text for the re-parse.
 */
function backtick(src, i, addSubst) {
  const n = src.length;
  let body = '';
  while (i < n && src[i] !== '`') {
    const d = src[i + 1];
    if (src[i] === '\\' && (d === '`' || d === '$' || d === '\\')) {
      body += d;
      i += 2;
    } else {
      body += src[i++];
    }
  }
  addSubst(body);
  return Math.min(i + 1, n);
}

/**
 * Skip `$((...))` arithmetic; `i` is just after the `$((`. A `$(...)` or backtick inside it
 * still runs, so those are reported. Returns the index after the closing `))`.
 */
function arithmetic(src, i, depth, st, addSubst) {
  if (depth + 1 > MAX_NEST) {
    st.overflow = true;
    return src.length;
  }
  const n = src.length;
  let level = 2;
  while (i < n && level > 0) {
    if (src[i] === '$' || src[i] === '`') {
      const e = expansion(src, i, depth + 1, st, addSubst);
      if (e !== -1) { i = e; continue; }
    }
    if (src[i] === '(') level++;
    else if (src[i] === ')') level--;
    i++;
  }
  return i;
}

module.exports = { scan };
