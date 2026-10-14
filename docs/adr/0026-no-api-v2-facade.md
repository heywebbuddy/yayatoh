# ADR 0026 — No `/api/v2` facade; supersedes ADR 0007

- **Status:** Proposed (M7.1b, 2026-10-13; draft for the owner's approval). Supersedes [ADR 0007](0007-legacy-api-v2-facade.md) once accepted.
- **Relates to:** `docs/plans/mobile.md` (decision P7-4), ADR 0025 (mobile apps), roadmap §6.2, §7.6

## Context
- ADR 0007 kept the legacy store apps working through a frozen, allowlisted `/api/v2` facade because no mobile build was planned. On 2026-10-13 the owner started building new apps from scratch (P7-2), so the reason for the facade is gone.
- Legacy responses are quirky and some leak private fields. Reproducing them byte for byte is permanent upkeep for apps that are being replaced.
- P7-4: the new attendee app goes on the existing Yayatoh store listing (same bundle ID and package name) when the owner has App Store Connect and Play Console access; otherwise it gets a new listing.

## Decision
- **Do not build the `/api/v2` facade.** `packages/legacy-v2` is not extended and no new route is added. Anything already on `main` stays frozen under ADR 0007's rules until cutover.
- **Old installs keep working until the yayatoh.com cutover and stop afterwards.** The new app must therefore be in the stores before cutover (B-Y).
- Cutover emails tell buyers about the new app. Tickets stay available on the web and by email.
- **ABC Chicago:** the app is left alone until ABC 2026 is over, then removed from sale. ABC attendees use the Yayatoh app through `abc.yayatoh.com` links.
- New clients use `/v1` only (additive changes, oasdiff gate), through `@yayatoh/sdk`.

## Alternatives
- **Build the facade (ADR 0007):** keeps old installs alive after cutover, at the cost of a second contract to freeze, test against golden HARs and secure. Rejected.
- **Force an upgrade in the old apps:** they cannot be changed. Not possible.

## Consequences
- Old-app users must install the new app before cutover; the store listing carries the upgrade (P7-4).
- The §7.6 sunset timeline for the facade no longer applies.
- If the owner cannot give store access in time, buyers lose in-app tickets at cutover and use the web and email tickets.

## Revisit when
- Telemetry shows a large share of buyers still on old installs close to the cutover date.
