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
 * redirects or substitutions are not reported. A newline right after `|` or `|&` does not end
 * the pipeline, so a command split over two lines (`a |` newline `b`) keeps one `pipeline`.
 *
 * Substitution bodies are not parsed here. Each one is found by scanning to its matching `)`
 * (honoring quotes, heredocs, nested parens and `case` patterns), stored raw in `substs`, and
 * replaced by an empty string in its word; a later layer re-parses the bodies.
 *
 * Arithmetic. `$((...))` and a command-leading `((...))` are skipped, though a `$(...)` nested
 * inside one is still reported. Bash calls `((` arithmetic only when the `)` that closes the
 * second paren is immediately followed by another `)`; otherwise `$((cat x) | sh)` is a
 * substitution and `((a); b)` is nested subshells. arithClose makes the same call with a
 * look-ahead over quotes and parens, so neither reading can hide a command and a `<<` inside
 * `((x=1<<2))` is not taken for a heredoc. A `((` can open arithmetic wherever a command can
 * start: at the start of a segment and after `if`, `elif`, `while`, `until`, `then`, `else`,
 * `do`, `{`, `!`, `time` and `for`. The look-ahead has a total work budget of 16 passes over
 * the input; past it the `((` is read as parens or a substitution and `overflow` is set.
 *
 * scan never throws. Unterminated quotes, substitutions and heredocs close at end of input.
 * `overflow` means the text could not be followed to its end, so the caller should treat the
 * command as unparsed. It is set when substitutions nest more than MAX_NEST deep (the rest of
 * the input becomes that body), when the arithmetic look-ahead runs out of budget, and when a
 * heredoc never finds its delimiter line. The last one is the backstop for every `<<` that bash
 * reads as arithmetic and this module does not (`$[1<<2]`, `a[1<<2]=5`, `${a[1<<2]}`): read as a
 * heredoc, its body would run to end of input and hide every later command.
 *
 * A heredoc inside a substitution may also end on a line that starts with its delimiter and a
 * `)` (`EOF)`), and that `)` closes the substitution. Bash accepts the form with a warning, so
 * `$(cat <<EOF`, `hi`, `EOF) ; next` on three lines runs `next` as a command; the body is not
 * allowed to swallow it.
 *
 * Known gaps, kept out on purpose:
 *   - `${...}` is not parsed as a unit (so `${X:-a b}` splits on the space).
 *   - `<<` inside `$[...]`, a subscript or a `${x:off}` offset is read as a heredoc; the only
 *     protection is the `overflow` backstop above.
 *   - `case` patterns are followed by a small state machine (`case WORD in`, then `)` ends a
 *     pattern until the next `;;`, `;&`, `;;&` or `esac`). It does not follow extglob patterns
 *     (`@(a|b)`), a `)` inside a bracket expression (`[)]`), or `in` on a line of its own.
 */

const MAX_NEST = 16;
// Reserved words after which a command can still start, so `then case x in` is a case command
// and `while ((` opens arithmetic. `for` is here only for `for ((`: the word after it, a loop
// variable, ends the lead like any other word.
const LEAD_WORDS = new Set(['if', 'then', 'elif', 'else', 'while', 'until', 'do', 'for', '{', '!', 'time']);

function scan(cmd) {
  const src = typeof cmd === 'string' ? cmd : '';
  // `work` and `limit` meter the arithmetic look-ahead (see arithEnd).
  const state = { overflow: false, work: 0, limit: 16 * src.length + 1024 };
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
  // The last separator was `|` or `|&`, so a newline next continues that pipeline.
  let afterPipe = false;
  // `case WORD in ... esac` tracking. `lead`: no command word yet in this segment (reserved
  // words like `then` do not count). `caseWords`: words seen since `case` (3 = `case WORD in`).
  // `cases`: open case commands; `pattern` is true between `in` / `;;` and a pattern's `)`.
  let lead = true;
  let caseWords = 0;
  const cases = [];

  const addSubst = (body) => { seg.substs.push(body); };
  const isEmpty = () => !inWord && !pending && !keepSeg
    && !seg.words.length && !seg.redirects.length && !seg.substs.length;
  // The innermost open case command, if it was opened at this paren level.
  const caseHere = () => {
    const k = cases[cases.length - 1];
    return k && k.parens === parens ? k : null;
  };
  // A `((` opens arithmetic only where a command can start: at the start of a segment, after a
  // reserved word that can precede a command (`while ((`, `do ((`) and after `for`. Anywhere
  // else, `echo a ((1))` is a syntax error in bash and the parens are ordinary subshell parens.
  const arithCanStart = () => lead && !inWord && !pending && !seg.redirects.length;

  // A pattern's `)` must not close an enclosing `$(...)`, so the scanner has to know when it is
  // between `case WORD in` and the pattern's `)`. `esac` in command position ends the case.
  function noteWord() {
    if (caseWords) {
      if (++caseWords === 3) {
        caseWords = 0;
        if (!quoted && cur === 'in') cases.push({ parens, pattern: true });
      }
    } else if (lead) {
      if (quoted) lead = false;
      else if (cur === 'case') { caseWords = 1; lead = false; }
      else if (cur === 'esac') { if (caseHere()) cases.pop(); lead = false; }
      else if (!LEAD_WORDS.has(cur)) lead = false;
    }
  }

  function flushWord() {
    if (inWord) {
      const p = pending;
      pending = null;
      if (!p) {
        seg.words.push(cur);
        noteWord();
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
    lead = true;
    caseWords = 0;
    afterPipe = samePipeline;
  }

  // Read the bodies of every pending heredoc, in order, starting at `pos` (just after a
  // newline). A body ends at a line equal to its delimiter, or at end of input. Quoted
  // delimiters make the body literal and it is dropped; otherwise only its $(...) and
  // backticks matter. A body that never finds its delimiter runs to end of input and sets
  // `overflow`: when the `<<` was really arithmetic, that body is every later command.
  // Inside a substitution, bash also ends the body at a line that starts with the delimiter
  // and a `)`. The scan then resumes at that `)` so it closes the substitution, and any
  // heredoc still pending is dropped (its text is read as commands, which can only over-report).
  function readHeredocBodies(pos) {
    while (heredocs.length) {
      const h = heredocs.shift();
      const bodyStart = pos;
      let bodyEnd = n;
      let resume = n;
      let found = false;
      let byParen = false;
      while (pos < n) {
        const nl = src.indexOf('\n', pos);
        const lineEnd = nl === -1 ? n : nl;
        const tabs = h.strip ? /^\t*/.exec(src.slice(pos, lineEnd))[0].length : 0;
        const line = src.slice(pos + tabs, lineEnd);
        if (line === h.delim) {
          found = true;
          bodyEnd = pos;
          resume = Math.min(lineEnd + 1, n);
          break;
        }
        if (untilParen && line.startsWith(h.delim + ')')) {
          found = true;
          byParen = true;
          bodyEnd = pos;
          resume = pos + tabs + h.delim.length;
          break;
        }
        pos = lineEnd + 1;
      }
      if (!found) st.overflow = true;
      if (!h.quoted) {
        dqText(src.slice(bodyStart, bodyEnd), 0, false, depth, st, (body) => { h.owner.substs.push(body); });
      }
      pos = resume;
      if (byParen) heredocs.length = 0;
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
      // Right after `|` or `|&` the next line is the next pipeline member, not a new pipeline.
      endSegment(afterPipe && isEmpty());
      i = readHeredocBodies(i + 1);
      continue;
    }

    if (c === '#' && !inWord) {
      // A comment runs to end of line; an apostrophe inside it must not open a quote.
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }

    if (c === ';') {
      endSegment(false);
      // `;;`, `;&` and `;;&` end a case arm: the next thing is a pattern list again.
      const k = caseHere();
      if (k && (src[i + 1] === ';' || src[i + 1] === '&')) k.pattern = true;
      i++;
      continue;
    }

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
      const k = caseHere();
      if (k && k.pattern) { flushWord(); i++; continue; } // `a|b)` separates case patterns
      endSegment(true);
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }

    if (c === '(') {
      const k = caseHere();
      if (k && k.pattern) { flushWord(); i++; continue; } // optional `(` before a case pattern
      if (src[i + 1] === '(') {
        // A word right before `((` ends there (`while((`), so settle it before looking at the segment.
        flushWord();
        // `((` opening a command is arithmetic when it closes as `))`, else two subshell parens.
        if (arithCanStart()) {
          const end = arithEnd(src, i + 2, st);
          if (end !== -1) { i = arithmetic(src, i + 2, end, depth, st, addSubst); continue; }
        }
      }
      endSegment(false);
      parens++;
      i++;
      continue;
    }

    if (c === ')') {
      flushWord(); // may be `esac`, which closes its case before we look at the `)`
      const k = caseHere();
      if (k && k.pattern) { endSegment(false); k.pattern = false; i++; continue; }
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
 * `$((` is arithmetic only when arithEnd says it closes as `))`; otherwise it is a substitution
 * whose body starts with a subshell paren, as in `$((cat x) | sh)`.
 */
function expansion(src, i, depth, st, addSubst) {
  if (src[i] === '`') return backtick(src, i + 1, addSubst);
  if (src[i] === '$' && src[i + 1] === '(') {
    if (src[i + 2] === '(') {
      const end = arithEnd(src, i + 3, st);
      if (end !== -1) return arithmetic(src, i + 3, end, depth, st, addSubst);
    }
    return substitution(src, i + 2, depth, st, addSubst);
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
 * Skip arithmetic whose body starts at `i` (just after `$((` or a command-leading `((`) and
 * ends at `end`, the index after its `))` from arithEnd. A `$(...)` or backtick inside it still
 * runs, so those are reported. Returns the index after the arithmetic.
 */
function arithmetic(src, i, end, depth, st, addSubst) {
  if (depth + 1 > MAX_NEST) {
    st.overflow = true;
    return src.length;
  }
  const stop = end - 2;
  while (i < stop) {
    if (src[i] === '$' || src[i] === '`') {
      const e = expansion(src, i, depth + 1, st, addSubst);
      if (e !== -1) { i = e; continue; }
    }
    i++;
  }
  // Resume at `end`, not where the last nested expansion stopped: an expansion that ran past the
  // `))` (quotes make the two scans disagree) must not hide what follows. At worst the text
  // between is read twice, which only over-reports.
  return end;
}

/**
 * Decide whether a `((` or `$((` whose body starts at `i` opens arithmetic. Returns the index
 * after the closing `))`, or -1 when it does not (the text is a subshell or a command
 * substitution that happens to start with a paren). Each call is charged to st.work; once the
 * budget is spent it answers -1 and sets `overflow`, which keeps hostile input such as a long
 * run of `(` linear instead of one full look-ahead per paren.
 */
function arithEnd(src, i, st) {
  if (st.work > st.limit) {
    st.overflow = true;
    return -1;
  }
  const r = arithClose(src, i);
  st.work += r.stop - i;
  return r.end;
}

/**
 * Look ahead from `i` for the `)` that closes the second paren of `((`. Quotes and `$'...'` are
 * skipped whole, and parens nest, including `$(` inside double quotes. Backticks are skipped only
 * inside double quotes, which is what bash does: a bare `` `echo )` `` closes the pair early. The
 * `)` found at depth zero closes arithmetic only if the next character is also `)`. Returns
 * {end, stop}: the index after `))` (or -1) and how far the look-ahead read.
 */
function arithClose(src, i) {
  const n = src.length;
  const open = []; // innermost last: '(' for a paren or `$(`, '"' for an open double quote
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (open[open.length - 1] === '"') {
      if (c === '"') open.pop();
      else if (c === '`') { i = skipTo(src, i + 1, '`'); continue; }
      else if (c === '$' && src[i + 1] === '(') { open.push('('); i++; }
      i++;
      continue;
    }
    if (c === "'") { const q = src.indexOf("'", i + 1); i = q === -1 ? n : q + 1; continue; }
    if (c === '$' && src[i + 1] === "'") { i = skipTo(src, i + 2, "'"); continue; }
    if (c === '"' || c === '(') open.push(c);
    else if (c === ')') {
      if (!open.length) return { end: src[i + 1] === ')' ? i + 2 : -1, stop: Math.min(i + 1, n) };
      open.pop();
    }
    i++;
  }
  return { end: -1, stop: n };
}

/** Index after the next unescaped `q` at or after `j`, or past the end when there is none. */
function skipTo(src, j, q) {
  while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

module.exports = { scan };
