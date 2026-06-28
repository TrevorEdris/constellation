# Prose Slop Catalog

AI-generated prose has identifiable patterns that reduce information density, bore readers, and signal "no human reviewed this." This catalog covers three levels: phrase, structure, and content.

---

## Phrase-Level Slop

### Filler Openers

Phrases that consume words without adding information. They exist because LLMs predict the most statistically likely sentence start.

**Always delete these:**
- "It's worth noting that..." — If it's worth noting, just note it.
- "It's important to consider..." — State the consideration directly.
- "Interestingly, ..." — Let the reader decide what's interesting.
- "Notably, ..." — Same problem.
- "Surprisingly, ..." — Same problem.
- "In today's fast-paced world..." — Never write this.
- "When it comes to..." — Start with the actual subject.
- "Let's dive in" / "Let's explore" — Just begin.
- "Here's the thing:" — State the thing.
- "At the end of the day, ..." — Delete.
- "Needless to say, ..." — Then don't say it.
- "As we all know, ..." — Skip the throat-clearing.
- "It goes without saying..." — Then let it.
- "In order to..." — "To" works.

**Detection heuristic:** Any sentence that still makes complete sense after deleting its first clause is a filler opener candidate.

---

### AI Vocabulary

Words that LLMs overuse because they appear frequently in training data. They create a veneer of sophistication while saying nothing specific.

See `slop-word-list.md` for the full blocklist with replacement suggestions.

**High-frequency AI tells:**
- delve, leverage, utilize, facilitate, endeavor
- robust, seamless, cutting-edge, dynamic
- comprehensive, multifaceted, holistic
- foster, realm, tapestry, landscape
- crucial, vital, pivotal, paramount
- innovative, transformative, groundbreaking

**Detection heuristic:** If a word could be replaced by a simpler synonym without changing meaning, it's a candidate. If removing it entirely doesn't change the sentence's truth value, it's noise.

---

### Promotional Adjectives

Adjectives that belong in marketing copy, not technical documentation.

- groundbreaking, revolutionary, game-changing
- state-of-the-art, best-in-class, world-class
- unparalleled, unprecedented, unmatched
- next-generation, industry-leading

**Severity:** HIGH in technical docs. These erode trust. Readers expect specificity, not sales pitches.

**Fix:** Replace with measurable claims. "Groundbreaking performance" → "Handles 10k requests/sec on a single instance." If you can't make a specific claim, the adjective is empty.

---

### Empty "-ing" Phrases

Gerund constructions that gesture at action without describing it.

- "ensuring reliability"
- "showcasing features"
- "highlighting capabilities"
- "facilitating collaboration"
- "enabling scalability"
- "driving innovation"

**Detection heuristic:** "[gerund] [abstract noun]" — if neither word is specific to the domain, it's slop.

**Fix:** Describe the actual mechanism. "Ensuring reliability" → "Retries failed requests three times with exponential backoff."

---

### Hedging Language

Qualifiers that weaken statements unnecessarily. AI uses these because it's trained to avoid being wrong.

- "One might argue that..."
- "It could be said that..."
- "In some cases, it may be possible to..."
- "There are various approaches to..."
- "It is generally recommended to..."

**Fix:** Make the claim or don't. "It is generally recommended to use connection pooling" → "Use connection pooling." If the recommendation is conditional, state the condition: "Use connection pooling for services handling >100 concurrent connections."

---

## Structure-Level Slop

### Formulaic Three-Point Structure

AI defaults to exactly three supporting points for every claim, regardless of whether three is the natural number.

**Detection:**
- Every section has exactly three bullet points or sub-points
- Lists consistently contain three items across the entire document
- The third point often feels forced or redundant

**Fix:** Use as many points as the content requires. Two is fine. Five is fine. The number should follow from the subject, not from a template.

---

### Uniform Paragraph Length

Human writers vary paragraph length naturally — some are one sentence, some are five. AI produces paragraphs of uniform 3-5 sentence length throughout.

**Detection:**
- Count sentences per paragraph across the document
- Low variance (standard deviation < 1.0) across more than 5 paragraphs suggests AI generation
- Every paragraph has the same rhythm: claim, elaboration, example

**Fix:** Vary paragraph length intentionally. Short paragraphs for emphasis. Longer ones for complex explanations. Single-sentence paragraphs are fine.

---

### "It's Not X, It's Y" Parallelism

AI overuses this rhetorical structure because it appears "insightful."

**Examples:**
- "It's not about speed, it's about reliability"
- "This isn't just a framework, it's a philosophy"
- "It's not a bug, it's a feature" (when used unironically)

**Detection:** Pattern: `(It's|This is|It isn't|This isn't) not (about|just|merely) .+, (it's|this is) .+`

**Fix:** State the actual point directly. "Reliability matters more than speed for this service because dropped messages cost $X per incident."

---

### Snappy Triads

Three-beat cadences used as emphasis devices. AI favors these because they pattern-match to effective rhetoric.

**Examples:**
- "Simple, elegant, powerful"
- "Fast, reliable, secure"
- "Clean, modular, maintainable"
- "Read, understand, implement"

**Detection:** Three adjectives or verbs separated by commas as a standalone phrase or sentence.

**Fix:** Be specific or remove. "Fast, reliable, secure" → describe the actual performance characteristics, reliability guarantees, and security properties. Or just delete the triad — it's a slogan, not documentation.

---

### Excessive Emphasis

AI bolds or emphasizes words and phrases without clear purpose.

**Detection:**
- More than 2-3 bold/italic spans per paragraph
- Bolding that doesn't highlight key terms, warnings, or actionable items
- Random mid-sentence emphasis that doesn't serve scanning readers

**Fix:** Bold sparingly. Use it for terms being defined, warnings, and key takeaways — not for decoration.

---

### Unnecessary Emoji

Professional technical documentation rarely benefits from emoji.

**Detection:**
- Emoji used as bullet point markers
- Emoji decorating section headers
- Status indicators (checkmarks, crosses) where prose or tables suffice

**Severity:** LOW — context-dependent. Emoji in a casual README is fine. Emoji in API documentation or architecture docs is noise.

---

## Content-Level Slop

### Surface-Level Treatment

The text reads smoothly but says nothing a search engine summary wouldn't say. No concrete examples, no data, no domain-specific insight.

**Detection:**
- Paragraphs that could apply to any project in the same domain
- No concrete numbers, measurements, or specific implementation details
- Generic "how-to" advice without addressing the specific context
- Claims made without evidence or examples

**Fix:** Add specifics. Replace generic statements with concrete details from the actual codebase, actual metrics, or actual constraints.

---

### Restating Common Knowledge as Insight

Presenting widely known facts as if they were revelations.

**Examples:**
- "Testing is important for software quality" — in a doc written for software engineers
- "Security should be a priority" — in a security-focused project
- "Good documentation helps onboarding" — in a documentation guide

**Detection:** Would any reader of this document be surprised by this statement? If no, it's common knowledge restated.

**Fix:** Delete, or replace with specific, actionable guidance. "Testing is important" → "This module has no unit tests. Add tests for the three public methods before modifying them."

---

### Redundant Conclusions

"In conclusion" or "To summarize" sections that repeat what was just said without adding new insight.

**Detection:**
- Section header contains "conclusion", "summary", "to summarize", "in closing", "wrapping up"
- Content of the section is a subset of information already stated above
- No new information, recommendations, or next steps

**Fix:** Delete the section if it adds nothing. If a summary is genuinely needed (long document, multiple audiences), make it a **TL;DR at the top**, not a conclusion at the bottom.

---

### Idea Repetition

The same concept restated in different words across multiple paragraphs or sections.

**Detection:**
- Two or more paragraphs that could be summarized as the same single sentence
- The same recommendation made in the introduction, body, and conclusion
- "As mentioned above" / "As previously stated" followed by restating it anyway

**Fix:** Say it once, in the most appropriate location. Delete the duplicates.
