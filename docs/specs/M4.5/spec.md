# Spec: M4.5 — Guest website, program and gallery

- **Milestone:** M4.5 (roadmap §10 Phase 4, "M4.5 Guest website, program and gallery (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave D)
- **Status:** M4.5a built (2026-10-03); M4.5b (gallery) to follow
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0018 / 0022 (tokens and design v2 components only)

## M4.5a — guest website (done)

### 1. Goal and users
A wedding or gala host gives their guests one page with everything they need: a welcome, the
program built from the sub-events, travel and hotels, registry links and answers to common
questions. Guests open it from the invitation (an address plus a password printed on the card),
in any of the 13 languages, on a phone first. Nobody else ever finds it: it is behind a password,
never indexed and never on the marketplace (P4-3c).

### 2. References
- **Plan row:** M4.5a "A block-based guest site: program from the sub-events, travel, registry links, FAQ, a password, all locales. Themed with the design tokens; `noindex`; never on the marketplace". Acceptance: "Password gate and locales tested; the leak crawler finds no guest data".
- **Decisions:** P4-3 (c) the guest site is password-protected, `noindex`, never on the marketplace (D13); (a) guests are never marketing.
- **Builds on:** M4.1c sub-events (the program), M4.2a profiles (the wedding nav's `website` item, planner sections), M1.14 rate limiter and human check, M1.11d canary crawler and noindex guard, the M3.2 readiness checklist item `guestSitePublished` (was "coming soon").
- **Legacy evidence:** none (Eventmie Pro has no guest websites).

### 3. Scope
**In (built):**
- **Model** (module `guests`, schema `guests`; migration `0113_futuristic_warbird.sql`):
  - `sites`: one per event; an 8-character address code (`/w/{code}`, platform-unique), `draft | published`, title, intro, the hosts' writing language, a **scrypt hash** of the password (format held by a CHECK), `password_version`, `published_at`. A published site always has a password (CHECK).
  - `site_blocks`: ordered blocks (`position` 0…n-1) of kind `text`, `program`, `travel`, `registry`, `faq` with an optional heading and the kind's JSON content (`domain/site.ts`: Markdown sanitized on write, links https only, at most 20 items per block, 30 blocks per site). Content is read back item by item: anything malformed is dropped, never shown raw.
- **Program from the sub-events.** A program block shows either the sub-events **everyone is invited to** (default; new ones appear by themselves) or the host's pick. A sub-event for some guests only (a rehearsal dinner) therefore never appears on a page everyone with the password reads unless the host ticks it. Each item: name, times in the event's time zone (with its abbreviation), place and venue (name, city).
- **Commands** (`guests:write`, entitlement `website`; audited with field names only, never content or the password): `saveGuestSite`, `setGuestSitePassword` (6–72 characters; bumps the version), `publishGuestSite` (refused with `password_required` without a password), `addGuestSiteBlock`, `updateGuestSiteBlock` (checked against the block's kind; unknown sub-events refused), `moveGuestSiteBlock` (one step), `removeGuestSiteBlock` (a `delete`: refused while staff impersonate). Queries: `guestSite` (console; `hasPassword` only), `guestSitePublished` (readiness).
- **Password gate.** `guests.site_target(code)` (SECURITY DEFINER: published sites of live orgs, ids only) gives the tenant; the org never comes from a header. `publicGuestSite` returns `{ state: 'locked', eventName }` until the visitor's access proof matches, then the allowlisted site (`PublicGuestSiteDto`: no ids, no guest data). `unlockGuestSite` checks a typed password (case and surrounding spaces ignored, NFKC) in constant time and returns the proof: an HMAC of the site and its password version under `APP_TOKEN_SECRET`, kept in an httpOnly cookie `yy_site_{code}` (60 days). **A new password locks everyone out.** Taking the site down makes the address "not found" even with a valid cookie.
- **Abuse:** the web action is limited by the new M1.14 policy `guestSitePassword` (8 tries per device per 10 minutes, 30 per anonymous address, 300 per site per 15 minutes); past the device budget each try needs the human check.
- **Never indexed, never on the marketplace:** page type `token` for `/w` (strict CSP, `X-Robots-Tag: noindex, nofollow` on every host), `robots` meta `noindex, nofollow`, `Disallow: /w/` in every robots.txt, no sitemap entry, no domain events (so no projection or listing ever sees it). The front door treats `/w` as a new-app path.
- **Console** `/o/{org}/e/{event}/website` (replaces the "coming soon" placeholder; profiles whose nav lists `website`, planners included): status with the one primary action (publish / take offline) and the address to copy; password; title, welcome and writing language; the sections with per-section forms (list blocks show every saved row plus one blank row: fill it to add, clear a row to remove), move up/down buttons (no drag) and remove; add a section. Validation errors on the field (https only, required answers, short passwords, publishing without a password). Viewers read only.
- **Public page** `/{locale}/w/{code}`: phone first (44 px targets), design v2 components and tokens only. Locked: the event's name, the gate and a language list. Open: title, welcome, "On this page" links, the blocks (FAQ as disclosures), registry and travel links in a new tab with `rel="noopener noreferrer nofollow"`; the hosts' words carry `lang` (their writing language) and `dir="auto"`, the page's own words are in the visitor's locale; links to all 13 locales.
- **Readiness:** the wedding checklist item "publish your guest website" now counts and ticks once the site is published (`website` is no longer a placeholder section).
- **Messages:** `guestSiteHost.*` and `guestSite.*` (105 keys) in all 13 locales with per-locale plurals.

**Later / not yet:**
- Gallery: built in M4.5b (below).
- Content per language (the hosts write in one language; guests switch only the page's own words).
- Opening the site straight from a party's RSVP link without the password, and an RSVP block linking to the party's page.
- Themes beyond the design tokens (colours, photos, a cover image once the media pipeline is wired here).
- A printable card/QR code for the address (the RSVP and collector pages have one; easy to add).
- A changeable address (reset the code); today a new password is the way to lock people out.

### 4. Acceptance
| # | Criterion | Test |
|---|---|---|
| AC1 | Password gate: locked page shows the event name only; wrong password refused; right password (any case) opens; a new password locks earlier visitors out; publishing needs a password; unpublished → not found | `packages/testing/tests/guest-site.int.test.ts` ("the password gate"), `apps/web/e2e/guest-site.spec.ts` (gate, lock-out, 404) |
| AC2 | Locales: the gate and the site in every locale, Arabic right to left, the hosts' words keep their language | `apps/web/e2e/guest-site.spec.ts` ("Arabic …"), `apps/web/tests/messages.test.ts` |
| AC3 | The leak crawler finds no guest data: the locked gate is public (no canary), the unlocked site shows only the site's own columns and sub-event names/places | `apps/web/e2e/canary-crawl.spec.ts` ("the guest website …", `GUEST_SITE_ALLOW`), `packages/testing/tests/column-privacy.test.ts` |
| AC4 | No guest data on the page: program = sub-events everyone is invited to (or the host's pick); no guest, party, PIN or lookup code; no ids | `guest-site.int.test.ts` ("no guest data …"), `guest-site.spec.ts` |
| AC5 | Never on the marketplace and never indexed: no domain events, noindex header + meta, robots `Disallow: /w/`, not in the sitemap | `guest-site.int.test.ts`, `guest-site.spec.ts` ("never indexed …") |
| AC6 | Host builds the site from blocks with validation on each field; move/remove; saved after reload; keyboard only; axe light and dark | `guest-site.spec.ts` (host tests) |
| AC7 | Rate limit: past the device budget the human check appears | `guest-site.spec.ts` ("past the limit …") |
| AC8 | Tenant isolation, viewer read-only, impersonation (no deletes), read-only freeze (writes refused, guests still read) | `guest-site.int.test.ts`, `isolation` suite (fixture rows for both orgs) |
| AC9 | Pure rules: password policy and scrypt hash, access proof bound to site and version, program selection, https-only links, sanitized Markdown, malformed content dropped, no DTO field for the hash | `packages/modules/guests/tests/site.test.ts` |
| AC10 | Readiness: the checklist item counts and ticks when published | `apps/web/tests/readiness.test.ts`, `guest-site.spec.ts` ("the setup guide …") |

**Gate (M4.5a, 2026-10-03, on build branch + merge/next-3h):** lint, check:modules and typecheck (59/59) clean; unit 2697 passed; integration 1510 of 1511 passed (`marketing-analytics.int.test.ts` "the campaigns tile shows the event’s exact figures to the marketing role" got 0 attributed orders under full-suite load and passes alone, 13/13; it touches no guest code). e2e on all three projects: `guest-site.spec.ts` 30/30, `canary-crawl.spec.ts` (desktop) all passed, `social-workspace.spec.ts`, `noindex.spec.ts`, `security.spec.ts`, `front-door.spec.ts` all passed.

## M4.5b — Gallery (2026-10-03)

Plan row: uploads by guests and the host through a signed link, straight to storage (HEIC accepted), the re-encoding pipeline, the moderation queue (P4-6), a per-event cap and a per-guest quota, a live slideshow over SSE, video links only with a Stream adapter stub behind a port (P4-5). **Acceptance: the per-event storage cap is enforced.**

### What was built
- **New module `@yayatoh/gallery`** (tier 5, schema `gallery`; `MODULE.md`): `settings` (on/off, moderation `hold`|`auto`, cap, guest quota bytes and items), `uploaders` (a guest's typed name, or a host member), `items` (photo or video link; `uploading` → `pending` → `published`), `variants` (re-encoded files). All tenant tables with FORCE RLS, org-leading indexes, composite FKs (to `events.events`, cascade) and fixture rows for both orgs.
- **Uploads straight to storage.** A slot is a presigned PUT for exactly the declared size: `MediaStore.presignPut` (new, R2: SigV4 query signing with a signed `content-length`, tested against AWS's published vector). The Postgres store (dev, CI) can't sign, so `/api/gallery/direct/{token}` stands in (HMAC token: org, staging key, exact size, expiry) and stores the bytes unread. Completing reads the staged object, checks its size, sniffs it (JPEG, PNG, GIF, WebP, AVIF; **HEIC** through the `HeicDecoder` port; never SVG), re-encodes it with the media pipeline (`processImage`, now with a size option; EXIF/GPS never survive) and deletes the staging object after commit. Largest upload 25 MB. Slots expire after an hour and are swept before new ones are handed out.
- **Per-event cap and per-guest quota (P4-6).** Placeholders (`GALLERY_LIMITS`): 5 GiB per event, 250 MiB and 50 items per guest, 5,000 items per event. Hosts may lower them, never raise them. Usage = stored bytes of processed photos + declared bytes of open slots. Checked under the event's advisory lock when a slot is handed out (exactly at the cap is allowed, one byte over refused; concurrent slots are serialized) and again on completion with the stored size (an over-cap photo is deleted and the answer is `refused`/`event_cap`).
- **Moderation (P4-6).** Guest uploads wait for approval unless the event is set to auto-publish; host uploads publish at once. Approve one or all, reject (deletes rows and files), remove. Guests take back their own items.
- **Video (P4-5).** YouTube and Vimeo links only, parsed to provider + id; the pasted URL is never stored and pages get a canonical https link. `VideoHost` port with a Cloudflare Stream stub (`VIDEO_HOST=cloudflare_stream` + account id/token; refuses uploads until wired).
- **Live slideshow.** Realtime channel `event.gallery` (log; ids and states only). Hosts at `/o/{org}/e/{event}/gallery/slideshow` (realtime route, `guests:read`); guests at `/w/{code}/slideshow` through `/api/gallery/stream/{code}` (site password cookie + gallery on). New photos play next; pause/play, previous/next as 44 px buttons and arrow keys/Space; autoplay pauses on hover/focus and is off under reduced motion; announcements only for what a person did or new arrivals.
- **Privacy.** Guests reach the gallery only through the published guest site and past its password (`guestSiteAccessTx`, new in guests). Names and captions are personal columns; items leave only through allowlisted DTOs with **signed file URLs** (`/api/gallery/file/…?e=&s=`, valid to the end of the next UTC day, also checked against the item still existing; private cache, inert CSP, noindex). Nothing creates contacts or audience members, emits domain events, or reaches the marketplace (P4-3).
- **Console** `/o/{org}/e/{event}/gallery` (replaces the placeholder; `gallery` is no longer a placeholder section): status, storage meter against the cap, settings form, the guest address, host uploader, video link form, waiting-for-approval queue and the published grid. Viewers read only. Warns when the guest site isn't published.
- **Guest page** `/w/{code}/gallery`: the gate (comes back to the gallery), closed state, uploader with name (first time), caption and per-file results, quota line, full/quota-reached notices instead of the fields, video link form, "your photos" with state and take back, the published grid. The guest site shows "See and share photos" while the gallery is on.
- **Abuse:** new M1.14 policy `galleryUpload` (120 per device per hour, 240 per anonymous address, 5,000 per site, IP ceiling 2,000).
- **Messages:** `gallery.*` (169 keys) and `guestSite.galleryLink` in all 13 locales.

**Later / not yet:**
- A worker sweep for expired slots across all orgs (today they are swept per event when a new slot is handed out; they never count once expired).
- Real HEVC decoding in production (owner inbox); dev and CI decode a test container.
- Bulk download for the hosts; reordering; captions edited after upload; per-photo alt text separate from the caption.
- The canary crawl doesn't visit the gallery pages yet (columns are declared; the DTO allowlist and signed URLs are tested).
- Event deletion leaves gallery files in the store (rows cascade).

### Acceptance (M4.5b)
| # | Criterion | Test |
|---|---|---|
| AC1 | **The per-event storage cap is enforced**: at the slot (exact cap allowed, one byte over refused, host and guest), at completion (stored size), concurrent slots serialized, expired slots stop counting, a lowered cap blocks uploads, hosts can't raise it; the UI refuses and says the gallery is full | `packages/testing/tests/gallery.int.test.ts` ("the per-event storage cap is enforced"), `packages/modules/gallery/tests/gallery.test.ts` (quota), `apps/web/e2e/gallery.spec.ts` ("the per-event storage cap is enforced") |
| AC2 | Per-guest quota (items, bytes), other guests and hosts unaffected; video links count as items | `gallery.int.test.ts` ("the per-guest quota"), `gallery.spec.ts` ("the per-guest quota") |
| AC3 | Moderation: hold by default, auto-publish, host photos at once, approve/reject/remove, files deleted | `gallery.int.test.ts` ("uploads and moderation"), `gallery.spec.ts` ("the moderation queue") |
| AC4 | Straight to storage, HEIC accepted, re-encoded; SVG/junk/undecodable HEIC/size mismatch refused | `gallery.int.test.ts` ("what a photo may be"), `gallery.spec.ts` (host uploads), `packages/modules/media/tests/storage.test.ts` (presigned PUT) |
| AC5 | Live slideshow over SSE for hosts and guests; stream needs the password | `gallery.spec.ts` ("the live slideshow") |
| AC6 | Video links only; Stream stub behind the port | `gallery.test.ts`, `gallery.int.test.ts` ("video links only") |
| AC7 | Guest gate, signed file URLs, isolation, viewer read-only, impersonation, freeze | `gallery.int.test.ts`, isolation suite (fixture rows), `gallery.spec.ts` (viewers, guests) |
| AC8 | Keyboard only, axe light and dark, Arabic RTL, 13 locales | `gallery.spec.ts`, `apps/web/tests/messages.test.ts` |

**Gate (M4.5b, 2026-10-03, build branch + merge/next-3g + merge/next-3h + agent/m4.5a):** lint and check:modules clean; typecheck 60/60; unit 2734 passed; integration 1532 of 1532 (two media orphan-file checks were updated to count gallery files as referenced, then passed with the gallery tests, 50/50). e2e on all three projects: `gallery.spec.ts` 33/33; related `guest-site.spec.ts`, `media.spec.ts`, `program-media.spec.ts`, `realtime.spec.ts`, `canary-crawl.spec.ts`: 107 passed, 16 skipped (skips are in those specs by design).
