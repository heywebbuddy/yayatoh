# U10: Media library and settings parity

Source: `docs/plans/ux-review-1.md` (approved 2026-10-03), review point 11 (media) and 12 (storage, contact page, mail), decision **UX-3** (no per-org storage or SMTP credentials), principles 1–8 and row U10.

## What was built

### Media library (`/o/{org}/media`, Site & content)
- Every image the org has uploaded (its **originals**), newest first, with alt text, size, dimensions and **"Used in"** (links to the event media page, venue, speakers, exhibitors, sponsors or settings for the logo). Filter "Not used anywhere". An upload form puts images straight into the library (owner type `library`).
- **Reuse without re-uploading:** every image uploader (event cover and gallery, venue photos, speaker photo, exhibitor/sponsor logo, org logo) has "Choose from the media library": a radio group of thumbnails (keyboard: arrows, Space), the alt text for this place (prefilled with the library's, required unless decorative; logos and program photos are never decorative), "Use this image". Placing an image in a single slot replaces the current one; the same image twice in one slot is refused ("already here").
- **Data model** (`media.assets.source_asset_id`): a reuse is a placement row of its own (owner, slot, alt, position, `bytes = 0`) pointing at the original; its variant rows name the original's files. Nothing is stored twice; the quota counts only originals. Each placement has its own URL (`/media/{org}/{placement}/{file}`) and therefore its own visibility (a reuse on a published event is public while the library original stays members-only); `media.serve_target_v3` returns the asset whose files hold the bytes.
- **Delete only when unused:** only an original in the library with no reuse can be deleted (confirm step). Removing an original from its place while it is reused elsewhere **moves it to the library** instead of deleting it (files kept, reuses keep working); the same on replace and when a speaker/exhibitor/sponsor is deleted. A composite FK (`ON DELETE RESTRICT`) backs this. A data-subject erasure of a speaker removes their photo everywhere it was reused.
- Floor plan images stay uploads (they belong to seating plans) and are not offered for reuse.

### Storage (`/o/{org}/storage`, Settings)
- Numbers first: used / quota (default or staff-set), free space, images, stored files and reuses; usage by kind (event images, venue photos, program, logo, library only) with share bars; the 10 largest images with where they are used. Speaker portal documents are shown apart (they don't count against the image quota). No storage account to connect (UX-3).

### Email sending (`/o/{org}/sending`, Settings)
- "How your email looks" above the sending domain: **From name** and **Reply-To**, with a live inbox preview (`Name <address>`, "Replies go to …"). Applied to **every org email** the dispatcher sends (tickets, reminders, campaigns, journeys, member notifications) and to guest-code emails; SES gets `ReplyToAddresses`.
- Never spoofing: the From **address** is unchanged (the verified sending domain, else the platform sender). The name may not contain an address, `@ < > "`, control characters or anything that reads as a domain (`paypal.com`, `www.`); at most 80 characters (also a DB CHECK). Reply-To must be a valid address and not a Yayatoh one. Owners and admins edit (`org:update`); every member reads.

### Org contact page block (`/contact` on the tenant site, `/o/{slug}/contact` on the marketplace)
- Console: Site content › **Contact page** (`/o/{org}/content/contact`): on/off switch (adds Contact to the site menu and the organizer page), a line of text above the form, the public link, and the messages visitors sent (name, email, message, received, New/Handled, "Mark handled"). Viewers see the settings read-only and no messages (they hold visitors' details).
- Public form: name, email, message (10–4000 characters), a consent line ("{org} may use my name and email to answer"), the human check (Turnstile in production, the fake checkbox in dev/CI). Phone-first: full-width fields, 44 px send button.
- **Delivered exactly once:** the form carries a one-time key (`contact_requests.submission_key`, unique per org); a resubmission is the same message. The member notification (`cms.contact_message`, in-app + email to owners, admins, managers and marketing) is deduplicated by the message id.
- **Spam:** M1.14 rate limits (`orgContact`: device, IP, the sender's address at this org), a honeypot field, a signed fill-time stamp (under 2 s or forged: dropped silently; stale after 6 h), the human check.
- **No address exposed:** the page shows the org's name and its line only; replies go from the organizer's own mail. The canary crawl now visits both contact URLs of the canary org (whose Reply-To is a canary).

### Also in this increment
- `engagement` gets a contact-merge owner (`engagementContactOwner`): batch 3j added `engagement.engagement_events.contact_id` and `engagement.network_profiles.contact_id` after M6.1a required an owner for every contact column, so every integration fixture's merge refused (`owners_missing`) on the 3u base.

## Not yet / later
- Choosing library images inside CMS pages and blog posts (CMS entries have no images yet; M1.4g's cover hook).
- Bulk upload and folders/tags in the library; search by alt text.
- Raising the quota is a staff action (admin), unchanged; no self-serve storage add-on.
- The organizer answers contact messages from their own mail client (the notification email carries the visitor's address); replying from the console is a later messaging increment.
- `nav.sendingSetup` keeps its label "Sending setup" (existing e2e and docs use it); the page now leads with the From name and Reply-To.

## Acceptance

| Criterion | Test |
|---|---|
| Reusing an image never duplicates the stored file | `packages/testing/tests/media-library.int.test.ts` ("never duplicates the stored file"); e2e `apps/web/e2e/media-library.spec.ts` (stored-file count unchanged after two reuses) |
| Quota usage matches stored files | `media-library.int.test.ts` (usage = bytes of the originals' stored objects, both orgs) |
| Alt text required; used-in list; delete only when unused | `media-library.int.test.ts`; e2e `media-library.spec.ts` |
| Removing a reused original keeps the reuses (moves to library) | `media-library.int.test.ts` |
| Every org email carries the configured From name and Reply-To | `packages/testing/tests/email-identity.int.test.ts` (dispatcher, SES request); e2e `org-contact.spec.ts` (the owner's email) |
| From name / Reply-To validated, never spoofing | `email-identity.int.test.ts`; e2e `org-contact.spec.ts` |
| The contact form delivers once | `packages/testing/tests/org-contact.int.test.ts` (resubmission + replayed subscriber); e2e `org-contact.spec.ts` (two drains, one email) |
| The contact form never exposes the org's address | e2e `org-contact.spec.ts` (page HTML); `canary-crawl.spec.ts` (tenant and marketplace contact pages of the canary org) |
| Spam protection | `apps/web/tests/contact-spam.test.ts` (stamp, honeypot); rate policy `orgContact` |
| E2E: upload once, reuse in two places | `media-library.spec.ts` |
| E2E: set From name and Reply-To | `org-contact.spec.ts` |
| E2E: submit the contact form | `org-contact.spec.ts` |
| Keyboard only, axe in both themes, RTL | `media-library.spec.ts`, `org-contact.spec.ts` |
| Tenant isolation | `isolation.int.test.ts` (fixture rows for `cms.contact_pages`, `notifications.email_settings`, library + reuse rows for both orgs); cross-org reuse refused in `media-library.int.test.ts` |

Screenshots: `docs/ux/screenshots/u10/`.
