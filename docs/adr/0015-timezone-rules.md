# ADR 0015 — Timezone rules

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §9 (Time), M0.4)

## Context
- Events happen in many places; organizers, attendees and staff may sit in other zones.
- Legacy stored event dates as local wall-clock DATE + TIME columns, PHP ran in UTC, and `app.timezone` was overwritten at runtime (roadmap §1.3b). Some legacy comparisons used the server clock.
- Messaging must respect quiet hours, which depend on where the recipient is.

## Decision
- **Store `timestamptz`** for every timestamp.
- **Event times render in the event's IANA timezone**, derived from the venue location. Occurrences (`starts`, `ends`, `doors`) carry their timezone.
- **Reports use the org timezone** (`organizations.timezone`).
- **Quiet hours use the recipient's timezone**, with federal plus state rules (e.g. TX, FL, OK).
- Event modes (planning, pre_show, live, wrap) are computed in the venue timezone.
- Tz helpers live in `packages/kernel` (universal).
- **Migration:**
  - System timestamps convert with `AT TIME ZONE <app.timezone>` (America/New_York is likely; confirm in M0.4). DST fall-back rows are logged.
  - Event wall-clock fields are venue-local, stored as local time plus the event's IANA timezone (e.g. ABC Chicago → America/Chicago).
  - A spot check covers 50 events. Legacy server-clock comparisons are recorded as known bugs; the fix uses venue time.

## Alternatives
- **Naive local timestamps (legacy).** Rejected: ambiguous across DST and zones.
- **Single platform timezone.** Rejected: wrong for events outside it.

## Consequences
- Every UI date component needs the right zone for its context (event, org or viewer).
- ELT validation V12 covers timezone spot checks.
- Tests must include DST transitions.

## Revisit when
- M0.4 data audit shows a legacy timezone pattern these rules do not cover.
