## Summary
<!-- Plain English: what changed and why, for a non-engineer. -->

## Milestone and spec
- Milestone: <M0.x / M1.x>
- Spec: <docs/specs/...>

## Risk tags
<!-- Owner approval required if any box is ticked. -->
- [ ] db-migration
- [ ] auth
- [ ] payments
- [ ] tenancy
- [ ] infra
- [ ] mobile-contract
- [ ] legal-copy

## Migration summary
<!-- Tables and columns changed, expand/contract step, lock_timeout, concurrent indexes, destructive steps. "None" if no migration. -->

## Acceptance checklist
<!-- One line per acceptance criterion ID from the spec, with its test. -->
- [ ] AC-...: <criterion> — `<test>`

## Preview URL
<!-- Vercel preview link. -->

## Demo script
1. <step>

## Verification
- [ ] `pnpm verify` passes locally (paste the summary below)
- [ ] CI gates green (lint, boundaries, typecheck, unit, integration, isolation, canary leak, oasdiff, axe, bundle budgets, gitleaks)

```
<pnpm verify output>
```
