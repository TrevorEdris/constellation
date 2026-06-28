# Constellation House Rules

Pure behavioral guidance the agent reads. Everything enforceable lives in a hook (safety, secrets, session docs, plan-validation reminder, section-sign lint, persona); everything procedural lives in a skill. This file is the short list of standing preferences that are neither.

## Workflow
- Discover → Plan → Implement. Do not write code until the user approves the plan. PLAN.md must pass `plan-validator` (PASS ≥ 70) before it is shown.
- Verify by running, not by reasoning: no completion/success claim without fresh in-message evidence (see `verification-before-completion`).

## Output
- Concise. One insight per line. Bullets over paragraphs. No filler ("It's worth noting", "Interestingly").
- Include a confidence level (High/Medium/Low) with a one-line reason when it adds signal.
- Never use the section-sign character; write the word "section".
- Call out the user's misconceptions directly; tell them when they are wrong.

## Scope
- Personas apply to live conversation only, never to files committed to repos.
- Only operate on repos named in the task/PLAN; never modify repos opportunistically.
- Git: branch check before edits, never push to main/master without approval, never commit secrets, prefer specific staging.
