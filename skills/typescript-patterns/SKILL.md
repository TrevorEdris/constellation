---
name: typescript-patterns
description: "Use when writing, reviewing, or refactoring TypeScript code -- the type system, error handling, async, testing, and project structure."
tags: [typescript]
---

# TypeScript Patterns

Authoritative reference for idiomatic TypeScript (5.x, strict mode). Each reference file is self-contained and can be loaded independently.

---

## When to Use

- Writing new TypeScript modules, services, or APIs
- Reviewing TypeScript PRs for type safety and correctness
- Refactoring JavaScript to TypeScript
- Setting up a new TypeScript project (tsconfig, tooling)
- Debugging TypeScript type errors or build issues

---

## Quick Reference

| Topic | Reference File | Contents |
|-------|---------------|---------|
| Core idioms | `references/idiomatic-typescript.md` | Strict mode, const assertions, satisfies, narrowing |
| Type system | `references/type-system.md` | Generics, discriminated unions, branded types, conditional types |
| Error handling | `references/error-handling.md` | Result types, Zod validation, error boundaries |
| Async patterns | `references/async-patterns.md` | Promises, async/await, AbortController, concurrency |
| Testing | `references/testing.md` | Vitest, type-safe mocks, coverage |
| Project structure | `references/project-structure.md` | tsconfig, module resolution, monorepo |

---

## Limited Context Strategy

When context is tight, load only what you need:
- **Most tasks:** `idiomatic-typescript.md` + `error-handling.md`
- **Complex type work:** add `type-system.md`
- **Async services:** add `async-patterns.md`
- **Test writing:** `testing.md` only
- **New project setup:** `project-structure.md` only

---

## Overview

TypeScript with `strict: true` eliminates entire classes of runtime bugs through compile-time verification. Modern idiomatic TypeScript means:
- Discriminated unions over class hierarchies for modeling state
- Branded types for domain primitive safety
- Zod for runtime validation at system boundaries
- Vitest or Jest with typed mocks for testing

---

## Tooling Quick Reference

| Tool | Command | Purpose |
|------|---------|---------|
| `tsc` | `tsc --noEmit` | Type-check without emit |
| `eslint` | `eslint . --max-warnings 0` | Lint |
| `prettier` | `prettier --check .` | Format |
| `vitest` | `vitest run` | Tests |
| `tsx` | `tsx src/index.ts` | Run TS directly (dev) |

---

## Triggers

| Trigger | Example |
|---------|---------|
| Writing TypeScript | "implement a retry function in TypeScript" |
| Reviewing TS PRs | "review this TypeScript service" |
| Type errors | "how do I fix this 'Type X is not assignable to Y'?" |
| Async design | "design an async queue with backpressure" |
| Generics help | "how do I make this function generic?" |
| Project setup | "set up a TypeScript Node.js service" |

---

## Key Terms

| Term | Definition |
|------|------------|
| **Discriminated union** | Union type with a shared literal field (`kind`, `type`) enabling exhaustive narrowing |
| **Branded type** | Nominal type created by intersecting a base type with a unique tag |
| **Type predicate** | Return type `arg is Type` — user-defined type guard |
| **Conditional type** | `T extends U ? X : Y` — type-level if/else |
| **Template literal type** | String type constructed from literal types: `` `${Prefix}_${string}` `` |
| **`satisfies` operator** | Validates that a value satisfies a type without widening it |
| **`infer`** | Captures a type variable within a conditional type |
