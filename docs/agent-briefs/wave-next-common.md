# Shared rules for the builders launched 2026-10-02 (Phase 4 Wave B, Phase 5 Wave 2)

Read `common.md` first; it applies in full. The rules below add to it or override it.

## Base
Start from `origin/merge/next-3e`, not from the build branch. It has batches 3c, 3d and 3e:
- the Command Center shell and alert engine
- messaging providers
- campaigns and journeys (M3.7a)
- support tools
- registration types and forms (M5.1a/b)
- agenda v2 (M5.2a)
- guest import and sub-events (M4.1b/c)

```
git fetch origin && git checkout -B {BRANCH} origin/merge/next-3e && git merge --no-edit origin/m0.5-foundation-ey5gqp
```
Before your final gate, fetch and merge the latest `origin/merge/next-3e`, `origin/merge/next-3f` (if it exists) and `origin/m0.5-foundation-ey5gqp`, with normal merges. Never recreate a module that is missing. Merge the branch that has it.

## Design v2 is in flight: no styling of your own
The owner approved a new design system on 2026-10-02 (`docs/decisions.md`; artboards in `docs/design/system-v2/`; brief `docs/agent-briefs/design-v2.md`). It is being built on `agent/design-v2` and will restyle every page by inheritance. To keep your work from conflicting with it:
- Build UI **only** from `@yayatoh/ui` components and tokens. No new raw colours, no one-off CSS, and no new shared components in `packages/ui`. If you need one, compose it locally in your feature folder from existing primitives and note it in your report.
- Don't touch `packages/ui`, `console-shell.tsx`, the org/event layouts, the global CSS or the theme code.
- Before your final gate, check whether `origin/agent/design-v2` exists and is ahead of your base. If it is, merge it (`git merge --no-edit origin/agent/design-v2`) and switch your new screens to its components (PageHeader, Tabs, StatusPill, EmptyState, Skeleton, Toast and so on). If that merge conflicts outside your own files, abort it (`git merge --abort`) and list it in your report; the merge session will do it.
- UX bar from the owner, regardless of styling:
  - one primary action per screen
  - empty states that say what to do next
  - inline validation, and success feedback
  - keyboard-only paths
  - 44 px touch targets on public/mobile pages
  - phone-first public pages

## Parallel builders (keep your changes additive)
These builders run at the same time:
- M4.1d RSVP flow
- M4.2b gala tables and sponsors
- M4.8a donations
- M5.1c approvals and groups
- M5.2b enrollment and waitlist
- M5.7a polls and Q&A

Shared modules:
- `guests`: M4.1d, M4.2b
- `ticketing`/`orders`: M4.2b, M4.8a
- `registration`: M5.1c, M5.2b
- `program`: M5.2b, M5.7a

In any module another builder also touches:
- append to `schema.ts`, `index.ts`, `private-columns.ts` and the fixtures; never reorder or rewrite them
- put new logic in new files
- write one new migration (it will be renumbered at merge)
