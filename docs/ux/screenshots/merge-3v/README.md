# Batch 3v merge — what looks different after the merge

Each builder's own before/after captures stay in `docs/ux/screenshots/u3/` … `u10/`. They were taken on
each branch alone. Where two branches changed the same screen, the merged screen differs from both;
those pages are captured again here, from the merged tree on the seeded `lakeside-events` org, as the
owner (`pani@lakeside.test`), at 1280 and 375 px in light and dark (file names end in `-{width}-{theme}.png`).

| Page | What changed in the merge | Captures |
|---|---|---|
| Domains (`/o/{org}/domains`) | U3's connect wizard now sits under U2's shared "How custom domains work" panel (collapsible, with a guide link). U3's own "How it works" card was dropped so every setup page has the same panel. | `domains-*` |
| Templates (`/o/{org}/templates`) | U6's **New template** button in the header, with U2's "How templates work" panel. The panel's three steps are now U6's (pick the kind of event → add tickets, sections, checklist → create events from it). U6's separate card was dropped. | `templates-*` |
| Coupons (`/o/{org}/coupons`) | U9's org-wide coupon list and form replace U2's interim page (which only pointed at each event's promo codes). U2's help panel stays, reworded for org coupons. Empty states: no events → "Create an event"; no codes → "Add a coupon" (jumps to the form). | `coupons-*` |
| Create event (`/o/{org}/events/new`) | Three branches meet here: U8's "What kind of event?" picker, U7's optional Series field and U9's currency picker, in that order. | `events-new-*` |
| Event header and Details (`/o/{org}/e/{event}/details`) | The header shows U7's "Part of {series}" chip and U6's "Save as template" button side by side. Details carries U8's org categories and tags and U9's currency section. | `event-header-details-*` |
| Command Center overview (`/o/{org}/command-center`) | U4's overview grouped by mode, with sales and tickets per event. Its empty state uses U2's wording and links to the events list. | `command-center-overview-*` |
| Series (`/o/{org}/series`) | U2's header action and help panel, with U7's series names linking to the new series page. | `series-*` |

Pages not listed look as in their builder's own "after" captures.
