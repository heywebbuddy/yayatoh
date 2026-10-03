# Spec: U3 — Review bugs: blog link, domain connect wizard, venue photos on create

- **Milestone:** U3 (UX review 1, `docs/plans/ux-review-1.md` §4, findings 2, 3 and 6)
- **Status:** Built (agent/u3, 2026-10-03)
- **Risk tags:** auth (step-up dialog; a dev/preview-only persona confirmation)
- **Related ADRs:** 0022 (design system v2)

## 1. Goal and users
An organizer reviewing the preview hit three dead ends: "View on your site" on a published post 404'd, adding a domain ended on "Please confirm it's you" with no way through, and the "Add a venue" form had no photo. U3 fixes the three and applies the UX principles (explain then ask, short forms, no dead ends) to the screens involved.

## 2. What was built

### Blog and page links on every host (finding 2)
- The URL logic moved to a pure module, `apps/web/src/lib/content-url.ts` (`contentHomeFor`, `contentUrlFor`, `organizerBase`); `server/cms.ts` wraps it with the request and the environment.
- Root cause: without a tenant site, `contentHome` always returned `/o/{slug}` on the apex as seen from the request. On dev and preview hosts (localhost, `*.vercel.app`) the apex is the request's own host, where `/o/…` is the **console**, so the link 404'd or opened the dashboard. The prefix now follows the host class the link lands on: `/organizers/{slug}` on dev hosts, `/o/{slug}` on the marketplace (also from the app host and tenant hosts, which link to the configured apex). Public canonical URLs on dev hosts are fixed the same way.

| Host class | Link |
|---|---|
| Managed subdomain (tenant site on) | `https://{slug}.yayatoh.events/blogs/{post}` |
| Custom domain (primary) | `https://{custom}/blogs/{post}` |
| Apex marketplace (no tenant site; from the app host too) | `https://yayatoh.com/o/{slug}/blogs/{post}` |
| Dev / preview | `{this host}/organizers/{slug}/blogs/{post}` |

### Domains: the step-up failure and the connect wizard (finding 3)
- **Root cause (reproduced):** preview reviewers sign in with one click on `/dev/login`. For owners (two-step verification is required) the server answers the authenticator challenge with the persona's dev secret, so the reviewer never had an authenticator. Ten minutes later, adding a domain opened "Confirm it's you" and asked for a 6-digit authenticator code they couldn't have. Cancelling left "Please confirm it's you to continue." with no way forward: the screenshot.
- **Fixes** (`components/step-up.tsx`, `server/step-up-actions.ts`):
  - On dev/preview only (`devAuthEnabled()`, never production), a seeded persona's dialog offers **"Continue without a code (demo account)"**. `confirmStepUpAsPersonaAction` runs the real step-up with the persona's own proof (TOTP from the dev secret, or the dev password), audited and rate limited like any other. Real accounts never see it.
  - The step-up error is no longer a dead end. `StepUpError` (used by `SettingsForm` and `StepUpForm`) adds a **"Confirm it's you"** button that sends the same submission again and reopens the dialog.
  - Starting the dialog can fail (an emailed code that can't be sent, the network). It now says so with **Try again** instead of sitting on "One moment…" with Confirm disabled. Staff impersonating a member are told they can't confirm for them.
- **Connect wizard** (`domains/wizard.tsx`, `lib/domain-wizard.ts`, `components/domains/*`):
  - A **How it works** panel sits above the page.
  - Each custom domain that is not yet live and primary carries its wizard inline: a stepper (Domain added → DNS records → Verified → Secure connection → Primary) and only the current step's content.
    - DNS records: provider-agnostic steps, the records table, and a **Copy** button for each name and value (named "Copy value of the TXT record", live "Copied").
    - **Check now** runs the live check. The page also refreshes every 30 s while a domain is pending; the background checks already record status.
    - The certificate step.
    - **Make primary**, behind step-up.
  - Failures show the reason as an alert with how to fix it.

### Venues: create → photos → details (finding 6)
- "Add a venue" asks only for the essentials: name, capacity, city, country, time zone and directory listing, plus a note that photos and details come next.
- After creating, the venue page shows a stepper (Create → Photos → Details), "Venue added." with the next step, the **inline photo uploader first**, then the Details section (address, map, coordinates, accessibility).
- The venue list shows each venue's first photo as a thumbnail (`venueThumbnails`, one query per page), with an initial tile for venues with no photo.
- The empty state links to the form.

## 3. Later / not yet
- The other forms that use `useStepUpActionState` with their own alerts (invite, API keys, refunds, account data, sandbox, date chart, member controls) still show the plain step-up error. They could adopt `StepUpError` in U11.
- Locally, the persona form's redirect on the app host names the server's own origin (`req.url`): a dev-only quirk, untouched here.
- A real hosting provider (Vercel Domains API) arrives with the owner's account. The wizard reads only `status`, `records`, `sslStatus` and `failureReason`, which the adapter will fill.

## 4. Acceptance
| Criterion | Test |
|---|---|
| Blog/page link resolves on dev hosts (`/organizers/{slug}`) | `apps/web/e2e/u3-review-bugs.spec.ts` "dev host…"; `apps/web/tests/content-url.test.ts` |
| … on the apex marketplace (`/o/{slug}`, also from the app host) | e2e "apex marketplace…"; unit "apex marketplace" |
| … on the managed subdomain and on a custom domain | e2e "managed subdomain and custom domain…"; unit tests per class |
| Adding a domain with an expired step-up window opens the dialog and completes (demo persona, and an authenticator user) | e2e "a demo persona…", "an owner with an authenticator…" |
| Cancelling is not a dead end ("Confirm it's you" resubmits, values kept) | e2e "a demo persona…" (keyboard only) |
| Connect wizard: how it works, copy records (clipboard checked), live check, certificate, primary with step-up, failure reason; RTL; axe in both themes | e2e "the wizard…"; `apps/web/tests/domain-wizard.test.ts` |
| Viewer: read-only domains | e2e "a viewer sees domains read-only…" |
| A venue is created with a photo in one flow; the public page shows it; the list shows a thumbnail; keyboard; axe both themes | e2e "create (essentials only) → photos → details…" |
| Arabic RTL of the new-venue steps | e2e "Arabic: the new-venue steps…" |
| Existing domain, step-up, CMS, venue and media journeys still pass | `domains.spec.ts`, `step-up.spec.ts`, `cms.spec.ts`, `venues.spec.ts` (validation of map link and coordinates moved to the details form, same assertions), `media.spec.ts` |

Screenshots (before/after, light and dark, 1280 and 390 px): `docs/ux/screenshots/u3/`.
