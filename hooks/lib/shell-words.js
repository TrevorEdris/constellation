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
 * parse(), commandOf() and gitCmd() are layered on top of scan; they are described before their
 * code near the end of this file, and they are what the guard rules call.
 *
 * A segment is one simple command: the text between unquoted `; && || | |& &`, newline, `(`
 * and `)`. `{`, `}` and `!` stay ordinary words (a later layer strips them in command
 * position), so `{}`, `{a,b}` and `${X}` pass through untouched. Segments that carry no words,
 * redirects or substitutions are not reported. A newline right after `|` or `|&` does not end
 * the pipeline, so a command split over two lines (`a |` newline `b`) keeps one `pipeline`.
 *
 * Substitution bodies are not parsed here. Each one is found by scanning to its matching `)`
 * (honoring quotes, heredocs, nested parens and `case` patterns), stored raw in `substs`, and
 * replaced by an empty string in its word; parse(), below, re-parses the bodies.
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

const path = require('node:path').posix;

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

// ---------------------------------------------------------------------------------------------
// Parser layer. scan() reads one piece of shell text; the code below finds the commands that hide
// inside a command (substitutions, `sh -c`, `eval`, `env -S`, `xargs`, `find -exec`) and reads
// the command word behind prefixes such as `sudo` and `env`.
//
//   parse(cmd)     -> { segments: Segment[], unparsed: null | 'size' | 'depth' }
//   commandOf(ws)  -> { cmd, args }
//   gitCmd(args)   -> { sub, args, dir }
//
//   Segment = Raw + {
//     position: number         index in the depth-first, source-order walk; children follow their parent
//     via:      'top' | 'subst' | 'shell-c' | 'xargs' | 'find-exec'
//     parent:   number | null  `position` of the segment this one came from (null at top level)
//     depth:    number         0 at top level, 1 more for each body re-parsed
//   }
//
// `pipeline` ids come from one counter per parse. An xargs or find-exec child takes its parent's
// id (it runs inside that pipeline); a substitution or `-c` body gets fresh ids of its own.
//
// Limits. Only the first 64 KiB (UTF-16 code units) of the text is scanned; longer input sets
// `unparsed: 'size'`. A body that would sit past depth 3 is skipped and sets `unparsed: 'depth'`.
// So does a scan that reports `overflow` (see the header of this file for its three causes), but
// in that case every segment the scan did return is kept, and its bodies are still re-parsed within
// the depth cap: a deny-tier command in the parsed part must stay visible. The first reason set
// wins. A caller that sees `unparsed` should add its own "could not fully read this" ask.
// ---------------------------------------------------------------------------------------------

const MAX_INPUT = 64 * 1024;
const MAX_DEPTH = 3;

function parse(cmd) {
  let src = typeof cmd === 'string' ? cmd : '';
  const ctx = { segments: [], unparsed: null, pipelines: 0 };
  if (src.length > MAX_INPUT) {
    src = src.slice(0, MAX_INPUT);
    ctx.unparsed = 'size';
  }
  addBody(src, 'top', null, 0, ctx);
  return { segments: ctx.segments, unparsed: ctx.unparsed };
}

/** Note that part of the command was not parsed. The first reason set stays. */
function skip(ctx, why) {
  if (ctx.unparsed === null) ctx.unparsed = why;
}

/** Scan `src` as shell text at `depth` and add its segments (and, below them, their children). */
function addBody(src, via, parent, depth, ctx) {
  if (depth > MAX_DEPTH) {
    skip(ctx, 'depth');
    return;
  }
  const r = scan(src);
  if (r.overflow) skip(ctx, 'depth');
  // Each scan numbers its own pipelines from 0; give this body's pipelines ids from the shared counter.
  const ids = new Map();
  for (const raw of r.segments) if (!ids.has(raw.pipeline)) ids.set(raw.pipeline, ctx.pipelines++);
  for (const raw of r.segments) addSegment(raw, ids.get(raw.pipeline), via, parent, depth, ctx);
}

function addSegment(raw, pipeline, via, parent, depth, ctx) {
  const seg = Object.assign({}, raw, { pipeline, position: ctx.segments.length, via, parent, depth });
  ctx.segments.push(seg);
  // A substitution runs while the words are expanded, so its commands come before the segment's own.
  for (const body of raw.substs) addBody(body, 'subst', seg.position, depth + 1, ctx);
  for (const e of hiddenCommands(raw.words)) {
    if (e.src !== undefined) {
      addBody(e.src, e.via, seg.position, depth + 1, ctx);
    } else if (depth + 1 > MAX_DEPTH) {
      skip(ctx, 'depth');
    } else {
      // The words are already split and unquoted, so the child is built from them directly.
      const child = { words: e.words, redirects: [], pipeline: seg.pipeline, substs: [] };
      addSegment(child, seg.pipeline, e.via, seg.position, depth + 1, ctx);
    }
  }
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/**
 * The commands a segment runs through its arguments: {via, src} for text to scan (`-c` strings,
 * eval, env -S) or {via, words} for a command already split into words (xargs, find -exec).
 */
function hiddenCommands(words) {
  const { cmd, args } = commandOf(words);
  if (SHELLS.has(cmd)) {
    const body = shellBody(args);
    return body === null ? [] : [{ via: 'shell-c', src: body }];
  }
  // eval joins its arguments with spaces and runs the result, so `eval cat x` and `eval "cat x"` agree.
  if (cmd === 'eval') return args.length ? [{ via: 'shell-c', src: args.join(' ') }] : [];
  if (cmd === 'env') {
    // env splices the words after STR into the split string (`env -S 'echo a' b` runs `echo a b`), so
    // the child text is STR plus every word after it, each quoted to stay one literal word. The
    // words start right after STR, not after env's options: `env -S cat -u f` hands `-u f` to cat.
    const o = readOptions(args, 0, PREFIXES.get('env'));
    if (o.values.S === undefined) return [];
    return [{ via: 'shell-c', src: [o.values.S].concat(args.slice(o.ends.S).map(singleQuote)).join(' ') }];
  }
  if (cmd === 'xargs') {
    const rest = args.slice(readOptions(args, 0, XARGS).next);
    return [{ via: 'xargs', words: rest.length ? rest : ['echo'] }];
  }
  if (cmd === 'find') return findClauses(args).map((w) => ({ via: 'find-exec', words: w }));
  return [];
}

/**
 * The command string of `sh [options] -c STRING`, or null when there is none. Options end at the
 * first word that is not one (or at `--`); `-c` may sit in a cluster (`-lc`, `-ec`); `-o` and `-O`
 * take the next word; the rest after the string are positional parameters. Without `-c` the first
 * word is a script file, which is not parsed.
 */
function shellBody(args) {
  let hasC = false;
  let i = 0;
  while (i < args.length) {
    const w = args[i];
    if (w === '--') { i++; break; }
    if (w.length < 2 || (w[0] !== '-' && w[0] !== '+')) break;
    i++;
    if (w[1] === '-') {
      if (w === '--rcfile' || w === '--init-file') i++;
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      if (w[k] === 'c' && w[0] === '-') hasC = true;
      else if (w[k] === 'o' || w[k] === 'O') i++;
    }
  }
  return hasC && i < args.length ? args[i] : null;
}

/**
 * Each `-exec|-execdir|-ok|-okdir cmd ... ;|+` clause of a find command's arguments, as word lists.
 * `+` ends a clause only right after `{}` (elsewhere it is an argument). A clause with no
 * terminator runs to the end: find would refuse it, but reporting its command costs nothing.
 */
function findClauses(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (!FIND_EXEC.has(args[i])) continue;
    const clause = [];
    let j = i + 1;
    for (; j < args.length; j++) {
      if (args[j] === ';' || (args[j] === '+' && args[j - 1] === '{}')) break;
      clause.push(args[j]);
    }
    if (clause.length) out.push(clause);
    i = j;
  }
  return out;
}

// -- Command words ------------------------------------------------------------------------------

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
// Words that can come before a command in command position. Matched as written, not by basename.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);

// An option table. `short`: letters whose value is the rest of the cluster or else the next word.
// `long`: long option name -> the letter it stands for, for long options that take a value (as
// `--name=value` or as the next word). Any other `-x` or `--name` is a flag with no value.
function opts(short, long) {
  return { short, long: long || {}, operands: 0 };
}

// Prefixes commandOf strips: commands that run another command given as their trailing words.
// Matched by basename, so `/usr/bin/env` counts. `operands` is how many plain words follow the
// options before the command (timeout's duration).
const PREFIXES = new Map([
  ['sudo', opts('ughpCDrtUT', { user: 'u', group: 'g', host: 'h', prompt: 'p', 'close-from': 'C', chdir: 'D', role: 'r', type: 't', 'other-user': 'U', 'command-timeout': 'T' })],
  // -S takes a string for the shell (see hiddenCommands); commandOf stops there.
  ['env', opts('uCS', { unset: 'u', chdir: 'C', 'split-string': 'S' })],
  ['command', opts('')],
  ['builtin', opts('')],
  ['nohup', opts('')],
  ['exec', opts('a')],
  ['nice', opts('n', { adjustment: 'n' })],
  ['timeout', Object.assign(opts('sk', { signal: 's', 'kill-after': 'k' }), { operands: 1 })],
  ['stdbuf', opts('ioe', { input: 'i', output: 'o', error: 'e' })],
  // Reserved in bash (`time -p cmd`) and also an external program (`/usr/bin/time -o f cmd`).
  ['time', opts('of', { output: 'o', format: 'f' })],
]);

// xargs. GNU's long forms of -I, -L and -E take an optional value (`--replace=R`, never a
// separate word), so only the others consume the next word.
const XARGS = opts('ILnPdEsa', { 'arg-file': 'a', delimiter: 'd', 'max-args': 'n', 'max-procs': 'P', 'max-chars': 's' });

const basename = (w) => w.slice(w.lastIndexOf('/') + 1);

// One word as shell text that scans back to exactly that word (a `'` becomes `'\''`).
const singleQuote = (w) => "'" + w.replace(/'/g, "'\\''") + "'";

/**
 * Read the options that start at words[i]. Returns the index of the first word that is not an
 * option (after an optional `--`) and the values taken, keyed by the option's letter. Short
 * options may be clustered (`-Eu root`); a valued one takes the rest of its cluster (`-uroot`) or
 * else the next word. `ends` holds, per valued option, the index just past its (last) value.
 */
function readOptions(words, i, spec) {
  const values = {};
  const ends = {};
  while (i < words.length) {
    const w = words[i];
    if (w === '--') { i++; break; }
    if (w.length < 2 || w[0] !== '-') break;
    i++;
    if (w[1] === '-') {
      const eq = w.indexOf('=');
      const name = eq === -1 ? w.slice(2) : w.slice(2, eq);
      if (Object.hasOwn(spec.long, name)) {
        if (eq !== -1) values[spec.long[name]] = w.slice(eq + 1);
        else if (i < words.length) values[spec.long[name]] = words[i++];
        if (values[spec.long[name]] !== undefined) ends[spec.long[name]] = i;
      }
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      if (!spec.short.includes(w[k])) continue;
      if (k + 1 < w.length) values[w[k]] = w.slice(k + 1);
      else if (i < words.length) values[w[k]] = words[i++];
      if (values[w[k]] !== undefined) ends[w[k]] = i;
      break;
    }
  }
  return { next: i, values, ends };
}

/**
 * The command a segment runs and its arguments, found by stripping from the front, repeatedly:
 * `NAME=value` words, the reserved words `if then else elif do while until ! { }`, and the
 * prefix commands in PREFIXES with their options. `cmd` is the basename. When nothing is left
 * after a prefix, the prefix is the command (bare `env`, `sudo`, `time`), with the words after it
 * as `args`; with no words at all (or only assignments) `cmd` is ''. `env -S STRING` is also left
 * as `env`: its string, followed by the words after it, is a command line that parse() reads.
 */
function commandOf(words) {
  const w = Array.isArray(words) ? words : [];
  let i = 0;
  let last = -1; // index of the last reserved word or prefix stripped
  while (i < w.length) {
    const word = w[i];
    if (ASSIGN.test(word)) { i++; continue; }
    if (RESERVED.has(word)) { last = i++; continue; }
    const name = basename(word);
    const spec = PREFIXES.get(name);
    if (!spec) break;
    last = i;
    const o = readOptions(w, i + 1, spec);
    if (name === 'env' && o.values.S !== undefined) return { cmd: 'env', args: w.slice(i + 1) };
    i = o.next + spec.operands;
  }
  if (i < w.length) return { cmd: basename(w[i]), args: w.slice(i + 1) };
  if (last === -1) return { cmd: '', args: [] };
  return { cmd: basename(w[last]), args: w.slice(last + 1) };
}

/**
 * Split git's arguments (the words after `git`) into subcommand, its arguments and the directory
 * named by `-C`. Global options before the subcommand are skipped: `-c k=v`, `--git-dir`,
 * `--work-tree` and `--namespace` (with a value, attached by `=` or as the next word), and any
 * other option such as `--no-pager`, `-P`, `--paginate`, `--bare`, `--literal-pathspecs` or
 * `--no-optional-locks`. Several `-C` compose left to right, as git does: a relative path extends
 * the previous one, an absolute path replaces it. `dir` is '' when no `-C` was given; `sub` is ''
 * when there is no subcommand.
 */
function gitCmd(args) {
  const a = Array.isArray(args) ? args : [];
  let dir = '';
  let i = 0;
  while (i < a.length && a[i].length > 1 && a[i][0] === '-') {
    const w = a[i++];
    if (w === '-C') {
      if (i < a.length) dir = joinDir(dir, a[i++]);
    } else if (w === '-c' || w === '--git-dir' || w === '--work-tree' || w === '--namespace') {
      i++;
    }
  }
  return { sub: i < a.length ? a[i] : '', args: a.slice(i + 1), dir };
}

function joinDir(dir, next) {
  return dir === '' || path.isAbsolute(next) ? next : path.join(dir, next);
}

module.exports = { scan, parse, commandOf, gitCmd };
