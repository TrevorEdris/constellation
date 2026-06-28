# Slop Word List

Canonical blocklist of AI-overused words and phrases organized by action required.

---

## Always Replace

These words are almost never the best choice. Replace with the suggested alternative based on context.

| Slop Word | Replacements |
|-----------|-------------|
| delve | explore, examine, investigate, look at |
| leverage | use |
| utilize | use |
| endeavor | try, attempt, effort |
| facilitate | enable, allow, help, let |
| comprehensive | thorough, complete, full |
| robust | strong, reliable, solid, durable |
| seamless | smooth, easy, integrated, transparent |
| cutting-edge | modern, new, latest, current |
| multifaceted | complex, varied, diverse |
| holistic | complete, whole, full, overall |
| foster | encourage, support, promote, grow |
| tapestry | (delete — almost never needed) |
| landscape | field, space, area, domain |
| realm | area, domain, field |
| paradigm | model, approach, pattern |
| synergy | (delete or describe the actual interaction) |
| ecosystem | system, platform, environment |
| streamline | simplify, speed up, reduce |
| spearhead | lead, start, drive |
| underscore | highlight, show, emphasize |
| bolster | strengthen, support, reinforce |
| pivotal | key, important, central |
| nuanced | subtle, detailed, complex |
| myriad | many, numerous, various |
| plethora | many, excess, abundance |
| testament | proof, evidence, sign |

---

## Almost Always Remove

These phrases can be deleted entirely. The sentence after them is the actual content.

| Phrase | Why It's Slop |
|--------|---------------|
| It's worth noting that | Throat-clearing. State the fact. |
| It's important to note that | Same. |
| It's important to consider | Same. |
| Interestingly, | Let readers decide what's interesting. |
| Notably, | Same. |
| Surprisingly, | Same. |
| In today's fast-paced world | Never write this. |
| When it comes to | Start with the subject. |
| Let's dive in | Just begin. |
| Let's explore | Same. |
| Here's the thing: | State the thing. |
| At the end of the day, | Delete. |
| Needless to say, | Then don't say it. |
| As we all know, | Skip it. |
| It goes without saying | Then let it. |
| In order to | "To" works. |
| The fact that | Usually deletable. |
| It should be noted that | Note it directly. |
| As previously mentioned | Don't re-mention — link or trust the reader. |
| In conclusion, | Delete if just repeating. TL;DR at top if needed. |
| To summarize, | Same. |
| Moving forward, | Delete. |
| With that being said, | Delete. |
| That said, | Usually deletable. |
| Having said that, | Delete. |
| All things considered, | Delete. |

---

## Context-Dependent

Flag these for human decision. Sometimes appropriate, often AI noise.

| Word/Phrase | When It's Slop | When It's Legitimate |
|-------------|---------------|---------------------|
| crucial | Emphasizing everything equally | Actual system-critical requirement (data loss, security) |
| vital | Hyperbole for routine items | Genuinely life-safety or business-critical |
| dynamic | Vague hand-wave at flexibility | Describing runtime-determined behavior specifically |
| innovative | Marketing copy in tech docs | Patent filings, grant applications |
| transformative | Grandiose claim without evidence | Documented measurable impact |
| scalable | Buzzword without specifics | Paired with concrete metrics ("handles 10x current load") |
| best practices | Often vague appeal to authority | When citing a specific, named practice from a known source |
| game-changing | Marketing slop | (Almost never legitimate in technical writing) |
| state-of-the-art | Unsupported superlative | Academic papers citing benchmarks |
| next-generation | Marketing | (Almost never legitimate in technical writing) |
| ensure | Often in "ensuring [abstract noun]" | When describing a specific guarantee mechanism |
| empower | Marketing for "let" or "enable" | (Rarely legitimate in technical writing) |

---

## AI Structural Tells

Not individual words, but patterns that signal AI generation:

| Pattern | Example | Fix |
|---------|---------|-----|
| Em dash overuse | "The system — which handles — all requests — efficiently" | Use commas or restructure. One em dash per paragraph max. |
| Snappy triads | "Simple, elegant, powerful." | Be specific or delete. |
| "It's not X, it's Y" | "It's not a tool, it's a philosophy" | State the point directly. |
| Colon-introduced lists after every claim | "There are three key benefits:" | Vary your sentence structures. |
| Rhetorical questions as transitions | "But what about scalability?" | State the concern: "Scalability requires..." |
