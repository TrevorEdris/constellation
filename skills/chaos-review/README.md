# chaos-review

Adversarial code review that assumes the worst about every change.

## Usage

```
/chaos-review                       # Review current pending changes
```

## When to Use

- Before merging changes to critical infrastructure or data paths
- When you want brutal honesty about failure modes in your code
- Reviewing distributed system changes for race conditions or blast radius
- Stress-testing a PR that "looks fine" but touches shared state

## What It Does

- Assumes worst-case scenarios for every code path
- Identifies failure modes, race conditions, edge cases, and blast radius
- Maps specific failure scenarios and their downstream impact
- Read-only — critiques but never proposes fixes

## References

- `references/attack-patterns.md` — Common failure patterns to check
