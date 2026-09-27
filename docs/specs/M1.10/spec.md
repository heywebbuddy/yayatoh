# M1.10 — Notifications and messaging core

Roadmap: M1.10 ("Platform senders: SES, Twilio toll-free/10DLC, WhatsApp as legacy does. FCM v1 and APNs with migrated tokens; web push. React Email templates with org and locale overrides. In-app inbox and preferences. Announcement push. Organizer↔customer messaging. 1:1 chat at parity, with report and block. Per-order message log; reminder idempotency; one-click unsubscribe. Acceptance: all templates render in 13 locales, RTL included; a duplicated job sends once; a migrated token receives push."). Roadmap §5.2 (message states), §6.4 (messaging pipeline, policy gate), §4.4 (platform sender), CLAUDE.md → Time (quiet hours in the recipient's timezone).

Delivered in three increments. **Risk tags:** `db-migration`, `tenancy` (new tenant tables, SECURITY DEFINER functions). All providers are owner accounts, so every channel runs behind a port with a fake adapter (see "Pending the owner").

Migration: `packages/db/drizzle/0039_melodic_adam_destine.sql` (new schemas `notifications` and `messaging`, 10 tenant tables; hand-written block listed below).

## M1.10a — notification core (done)
- **Platform port** (`packages/platform/src/notifier.ts`): `Notifier.enqueue(tx, intent)` and `Notifier.notifyMembers(tx, intent)`. An intent is roadmap §6.4's `MessageIntent`: kind, recipient (email, user, name, locale, timezone, phone), params, dedupe key, optional channels, order/event links and `sendAfter`. Modules depend on the port only (tenancy is tier 1 and cannot import a tier-2 module); the worker and web inject the implementation. The old `Mailer` port (`consoleMailer`/`memoryMailer`) is gone; tests use `memoryNotifier()`.
- **Module `@yayatoh/notifications` (tier 2**, depends on crm, tenancy, platform): owns schema `notifications`.
  - **Kinds registry** (`src/kinds.ts`): `orders.tickets`, `orders.refund`, `events.reminder`, `tenancy.invitation`, `ticketing.claim-link`, `ticketing.holder-link`, `attendees.message`, `messaging.announcement`, `messaging.reply`, `sales.order_paid` (member alert), `messaging.contact_replied` (member alert), `notifications.test`. Each kind fixes its category, default channels, required params and whether it is urgent (urgent kinds ignore quiet hours).
  - **Categories:** `transactional` (never suppressed), `reminders`, `event_updates`, `marketing`, and the member categories `sales` and `messages`.
  - **Deliveries** (`notifications.messages`): one row per `(org, channel, dedupe_key)`; `INSERT … ON CONFLICT DO NOTHING`, so a replayed or duplicated event queues nothing new. Params are stored **encrypted** with the org key envelope (they carry manage-link and invitation tokens). States: `queued` (with `send_after`; shown as *Scheduled* when in the future) → `sent` | `suppressed` | `failed` | `canceled`, with a `reason` (`quiet_hours`, `messaging_paused`, `unsubscribed`, `preference`, `no_device`, `no_address`, `provider_error`, `retrying`).
  - **Dispatcher** (`dispatchDueTx`): claims due rows with `SELECT … FOR UPDATE SKIP LOCKED` inside the tenant transaction, so concurrent dispatchers (a duplicated job, two worker machines) never hand the same row to a provider. Policy gate per row, in order: the staff kill switch `pause_messaging` (optional categories wait 15 min), unsubscribes, the recipient's preferences, then **quiet hours 21:00–08:00 in the recipient's timezone** (theirs, else the event's, else the org's) for non-urgent kinds. Provider errors retry with exponential backoff; the fifth failure is final. The worker ticks every 2 s (leader only) via `notifications.orgs_with_due_messages` (SECURITY DEFINER, `platform_reader`).
  - **Templates** (`src/templates/`): the repo's existing template approach (the escaped `html` tagged template from `@yayatoh/pdf`, ADR 0017), not React Email: the worker runs TypeScript natively with no JSX transform. Table layout for mail clients, logical properties, `lang` + `dir` (Arabic RTL), org name and brand colour (text colour picked for contrast), "Powered by" honoured, plain-text part, preview text. Copy lives in `src/templates/messages/<locale>.json` for all 13 locales with ICU plurals per locale. Money is formatted in the recipient's locale; event times in the event's timezone.
  - **Org overrides** (`notifications.template_overrides`): subject and opening paragraph per kind and locale, validated as ICU with only the kind's placeholders (`setTemplateOverrideCommand`, `org:update`; `previewTemplateQuery`). No console editor yet (see Later).
  - **Unsubscribe (RFC 8058):** every optional email carries `List-Unsubscribe: <…/api/unsubscribe/{token}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, plus a footer link to the page `/unsubscribe/{token}` in the recipient's language. The token is an HMAC of the message id (nothing stored); `notifications.message_org` (SECURITY DEFINER) resolves the org. Unsubscribing writes `notifications.suppressions` per email and category (and a withdrawn marketing consent in the crm ledger for marketing); members' own notifications flip their email preference instead. "Subscribe again" undoes it. Transactional mail has no unsubscribe link and always sends.
  - **Reminders:** a paid order queues `events.reminder` for 24 h before the start under `event-reminder:{event}:{email}`: one reminder per buyer and event however many orders they place. Not queued when the event starts within 24 h.
  - **Push:** `notifications.push_tokens` (fcm, apns, webpush). `importLegacyPushTokensTx` imports legacy device rows with their real platform (the legacy app sent APNs tokens through FCM). A provider's `invalid_token` disables the token.
  - **Channel adapters** (`src/transports.ts`): `EmailTransport`, `SmsTransport`, `PushTransport`. Development, preview and CI use `devMailboxTransports()` (JSON files read by the dev mailbox); tests use `memoryTransports()`. Production refuses to pretend: with no real adapter the worker leaves messages queued. Sender: `notifications@mail.yayatoh.com` with the org's display name (roadmap §4.4).
- **Existing sends moved onto the core** (same subscriber names, so processed-event history carries over): order tickets (`orders.ticket-mailer`, now also the reminder and the sales alert), invitations, claim links, holder links, guest-list emails (M1.8e). New: refund emails (`orders.refund-mailer` on `order.refunded@1`).
- **Per-order message log:** `orderMessagesQuery` (`orders:read`) on the organizer's order page ("Messages": when, message and subject, recipient, channel, status and reason); `buyerOrderMessagesTx` adds "Emails sent" to the buyer's order page (emails to the buyer's address only).
- **Dev tooling** (dev auth only, 404 otherwise, never in production): `POST /api/dev/outbox/drain` (runs an org's recent message events through the same subscribers as the worker and sends what is due, including quiet-hours holds, to the dev mailbox), `GET /api/dev/mailbox?to=`, and the page `/dev/mailbox`. e2e reads captured emails through these.

## M1.10b — in-app inbox and preferences (done)
- **Inbox** (`notifications.inbox_items`, per user, dedupe per user): `inboxQuery` (keyset paging), `inboxCountQuery`, `markInboxReadCommand` (ids or all; only the caller's items), `sendTestNotificationCommand`. The user always comes from the session, never from input; a system actor is refused.
- **Member alerts:** `notifyMembers` fans out by role per category (sales: owner, admin, manager, finance, box office; messages: owner, admin, manager, marketing, box office; viewers get neither). In-app is immediate; email and push go through the dispatcher and the member's preferences. Member emails resolve through the identity port (`getUsersByIds`).
- **Bell** (console header, `components/inbox-bell.tsx`): unread badge, accessible name "Notifications, N unread", native popover with the latest items, per-item "mark as read" and "mark all as read", links to the page and settings. Polls every 30 s while visible (Ably arrives later); a polite live region announces new counts. Keyboard: the bell opens with Enter, Escape closes.
- **Pages:** `/o/{org}/notifications` (all items, 20 per page, no-JS forms) and `/o/{org}/notifications/preferences` (sales, messages and "News from Yayatoh" × in-app, email, SMS, push; native checkboxes in fieldsets; "Send me a test notification"). Defaults: in-app on; email and push on for messages; SMS off; marketing off everywhere (consent is never invented).

## M1.10c — announcements and organizer↔customer messaging (done)
- **Module `@yayatoh/messaging` (tier 3**, depends on attendees, events, crm, notifications, tenancy): owns schema `messaging` (`announcements`, `threads`, `thread_messages`, `reports`).
- **Permissions** (tenancy): `messages:read` (owner, admin, manager, marketing, box office; event managers) and `messages:send` (owner, admin, manager, marketing; event managers). Viewers have neither.
- **Announcements** (event → Marketing, `/o/{org}/e/{event}/marketing`): compose (subject, message, email and/or push) → preview (the email as attendees see it and how many people it reaches) → "Send to N people" → sent log with delivery counts (sent · pending · not sent). `sendAnnouncementCommand` is idempotent (the key is minted at preview, so a double submit sends once), refused with no recipients or while messaging is paused. The worker fans out one message per address under `announcement:{id}:{email}`; people who blocked the organizer are skipped; push goes to attendees whose contact has an account.
- **Conversations:** one thread per org and contact email. Every announcement and reply links to `/messages/{token}` (HMAC of the thread id; `messaging.thread_org` resolves the org). The contact reads the history and writes back (max 10 messages an hour); the org's messages team gets an inbox alert. The organizer inbox (`/o/{org}/messages`: all / unread / blocked) and thread page (history, reply by email, block/unblock, report to Yayatoh). The contact can block the organizer (no more replies, and the org's event updates to that address stop via a suppression) and report. Public output is allowlisted (no staff names or internal ids).

## Later / not yet
- Real adapters: SES v2 (with Tenants in M3.5), Twilio SMS (toll-free + 10DLC), the WhatsApp template gateway, FCM HTTP v1, APNs, web push with VAPID keys. Push token registration exists as a command (`registerPushTokenCommand`); the buyer-page web-push opt-in and the service worker wait for VAPID keys.
- Provider webhooks (delivered, bounced, complained → `message_events`), bounce/complaint suppression, fallbacks (WhatsApp → SMS, push → email), segment counting, frequency caps and state quiet-hour rules (M3.5 policy gate).
- A console editor for template overrides (the commands and preview query exist).
- Rescheduling reminders when an event's start time changes (today the reminder keeps its original send time; the email shows the time stored when it was queued).
- Member email locale (member emails render in English until user locale preferences exist).
- Realtime inbox counts over Ably; the attendee app inbox (M1.15) and a `/v1` inbox API.
- Staff review of messaging reports in `apps/admin`.
- Legacy migration of notifications, chats, reports and blocks (roadmap §7).

## Pending the owner
- Provider accounts (SES production access and DKIM; Twilio toll-free verification and 10DLC; Meta business verification for WhatsApp; FCM service account; APNs key; VAPID keys) — `docs/owner-inbox.md`.
- Quiet hours default 21:00–08:00 (federal TCPA window) for email too, not only SMS. Recommended default applied; confirm or narrow to SMS/push.
- The kill switch `pause_messaging` holds everything except transactional mail (tickets, refunds, invitations, links, replies the customer asked for). Recommended default applied; confirm.
- The React Email choice (roadmap) is replaced by the existing escaped-HTML template approach because the worker runs TypeScript without a JSX step. Recorded here; confirm.

## Hand-written SQL (migration 0039, between `-- hand-written: begin/end`)
1. `REVOKE DELETE, TRUNCATE ON notifications.messages FROM app_user` (the message log is permanent).
2. `notifications.message_org(uuid)` SECURITY DEFINER → `app_user` (unsubscribe links).
3. `notifications.orgs_with_due_messages(integer)` SECURITY DEFINER → `platform_reader` (dispatcher).
4. `messaging.announcements` composite FK `(org_id, event_id)` → `events.events (org_id, id)`.
5. `REVOKE DELETE, TRUNCATE ON messaging.announcements FROM app_user` (the sent log is permanent).
6. `messaging.thread_org(uuid)` SECURITY DEFINER → `app_user` (reply links).

## Acceptance
| Criterion | Test |
|---|---|
| All templates render in 13 locales, RTL included | `packages/modules/notifications/tests/render.test.ts` (every kind × 13 locales, snapshots, `dir="rtl"` for Arabic, plurals, escaping, overrides) |
| A duplicated job sends once | `packages/testing/tests/notifications.int.test.ts` → "a duplicated job sends once" (three concurrent duplicate events → one row; three concurrent dispatchers with a slow provider → one send); messaging fan-out replay in `messaging.int.test.ts` |
| A migrated token receives push | `notifications.int.test.ts` → "a migrated legacy token receives push on its real platform" |
| Per-order message log (organizer and buyer) | `notifications.int.test.ts`; e2e `apps/web/e2e/notifications.spec.ts` (purchase → drain → "Emails sent" and "Messages"; empty log) |
| Reminder idempotency | `notifications.int.test.ts` → "one reminder per buyer and event" |
| One-click unsubscribe; transactional still sends | `notifications.int.test.ts` (headers, suppress, resubscribe, forged tokens); e2e `notifications.spec.ts` (captured email → page → one-click POST → Arabic → forged 404) |
| Quiet hours in the recipient's timezone; kill switch; retries | `packages/modules/notifications/tests/quiet-hours.test.ts`; `notifications.int.test.ts` "policy gate" |
| In-app inbox and preferences | `notifications.int.test.ts` "member inbox and preferences"; e2e `apps/web/e2e/inbox.spec.ts` (bell count, keyboard, mark read/all, inbox page, preferences persist, Arabic, cross-org 404) |
| Announcements (preview, confirmation, sent log, validation, viewer denied) | `packages/testing/tests/messaging.int.test.ts`; e2e `apps/web/e2e/messaging.spec.ts` |
| Organizer↔customer messaging with report and block | `messaging.int.test.ts` "conversations"; e2e `messaging.spec.ts` |
| Tenant isolation of every new table | `packages/testing/tests/isolation.int.test.ts` (fixture rows for all 10 tables in both orgs) |
