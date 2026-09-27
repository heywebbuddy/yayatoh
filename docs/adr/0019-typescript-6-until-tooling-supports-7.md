# ADR 0019 — TypeScript 6.0 until tooling supports 7

- **Status:** Accepted (M0.5, 2026-09-27)
- **Amends:** roadmap §3.1 (Runtime row: "TypeScript 7 strict").

## Context
- Roadmap §3.1 picks TypeScript 7, the native Go port. 7.0.2 is current.
- Key tools still rely on the TypeScript JS compiler API, which TS 7 does not ship:
  - Next.js 16.3 (type-checking during build, and `next typegen`)
  - drizzle-kit
  - Vitest
- The monorepo must build and test at M0.5.

## Decision
- Pin `typescript` **6.0.3** in the pnpm catalog.
- Keep every tsconfig TS-7-compatible:
  - `strict`
  - `moduleResolution: "Bundler"`
  - `verbatimModuleSyntax`
  - no deprecated options
- The upgrade to TS 7 is then a catalog bump.

## Alternatives
- **TS 7 via `tsgo` for typecheck only, plus TS 6 for tooling.** Rejected: two compilers, and their results can drift.
- **TS 7 everywhere.** Blocked: Next.js, drizzle-kit and Vitest cannot run on it yet.

## Consequences
- One compiler version across typecheck, build and tests.
- We give up TS 7's faster type-checking for now.
- New tsconfig options must stay valid under TS 7; deprecated options are not allowed.
- Renovate should not bump `typescript` to 7 until this ADR is superseded.

## Revisit when
- Next.js, drizzle-kit and Vitest support TS 7's API (or `@typescript/native-preview` reaches API parity).
