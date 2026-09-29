# Spec: M3.5 — Messaging platform and compliance

- **Milestone:** M3.5 (roadmap §8 Phase 3 "M3.5 Messaging platform and compliance", §6.4 messaging pipeline, §10)
- **Status:** M3.5a built (owner approved the Phase 3 plan, 2026-09-28); M3.5b (provider adapters) built 2026-09-29 — real providers switch on with the owner's accounts
- **Risk tags:** `db-migration`, `tenancy`, `legal-copy` (text-consent disclosure; state rules pending TCPA counsel; M3.5b HELP reply and STOP handling), `infra` (M3.5b provider accounts and webhooks)
- **Related ADRs / decisions:** D16 (sender of record; WhatsApp utility-only in the US; quotas until M6.6), 2026-09-28 "WhatsApp: one port, two adapters", 2026-09-28 "Messaging quotas per organization until paid plans"; M1.10 spec (dispatcher, categories, federal quiet hours, unsubscribe, suppressions, delivery events)

## M3.5a — policy gate v2 (built)

Migration: `packages/db/drizzle/0072_abnormal_black_widow.sql`: four new tenant tables in `notifications`, four columns on `notifications.messages`, changed CHECKs on `notifications.messages`, `crm.consents` and `messaging.announcements` (hand-written block below).

### 1. Goal and users
Organizers message attendees by email, push and now text; the platform must keep them inside the law and inside what Yayatoh pays for. A text without consent never goes out and the organizer sees why; texts wait for state calling hours (e.g. Texas Sundays); one person is not flooded; a tenant whose recipients complain too much pauses itself; each org has monthly quotas staff can set; recipients choose what they get from each org.

### 2. What was built
**The gate is a rule registry** (`packages/modules/notifications/src/policy/gate.ts`, `POLICY_RULES`). The M1.10 checks in `dispatchDueTx` are unchanged (kill switch, address suppressions, unsubscribes, preferences, federal quiet hours); the new rules run in two phases at two call sites, so parallel increments (M1.10e web push, M1.14e platform-wide erased-address suppression) add their own rules without touching the loop:
- `eligibility` (after preferences, before federal quiet hours): a `block` marks the message `suppressed` with the rule's reason.
- `timing` (after federal quiet hours): a `hold` keeps it `queued` with `send_after` and the reason (deferral, never drop).

| Rule | Phase | What it does | Reason in the log |
|---|---|---|---|
| `consent` | eligibility | SMS/WhatsApp in `reminders`, `event_updates`, `marketing` need consent in the crm ledger (latest row per contact × channel × purpose): **marketing needs express written consent** (`marketing` granted); reminders and updates need `informational` granted (a marketing grant covers them unless informational was withdrawn). Marketing **email** needs email marketing consent too. Transactional messages and members' own alerts (`sales`, `messages`) are not gated here. | `consent_missing`, `consent_withdrawn` |
| `whatsapp_category` | eligibility | Every kind has a WhatsApp template category (`utility` / `marketing` / `authentication`, `whatsappCategoryOf`); marketing to a +1 number is blocked (D16). | `whatsapp_marketing_us` |
| `state_quiet_hours` | timing | State calling-hour statutes as **data** (`policy/state-rules.ts`), for non-urgent SMS/WhatsApp. The state comes from the number's area code and/or the address's region (`to.region`, ISO 3166-2 e.g. `US-TX`); an area code that spans time zones is checked in each. | `state_quiet_hours` |
| `frequency_cap` | timing | Per recipient × channel: per category and across all optional categories ("per org"). Reminders and updates over a cap **wait** until the oldest counted message leaves the window; marketing over a cap is **skipped**. | `frequency_cap` |
| `quota` | timing | Monthly per-org quota per channel (org's calendar month). Over it, optional messages are **held** (re-checked hourly, or at the reset), never dropped. Transactional messages and members' alerts are never held (still metered). | `quota_reached` |

**State rules (all "pending TCPA counsel")**

| State | Allowed for texts (local time) | Citation |
|---|---|---|
| Texas | Mon–Sat 09:00–21:00; **Sunday 12:00–21:00** | Tex. Bus. & Com. Code § 301.051 |
| Florida | 08:00–20:00 every day | Fla. Stat. § 501.616(6)(a) (FTSA as amended 2021) |
| Oklahoma | 08:00–20:00 | Okla. Stat. tit. 15, § 775C.4 (2022) |
| Maryland | 08:00–20:00 | Md. Code, Com. Law § 14-4503 (2023) |
| Washington | 08:00–20:00 | RCW 80.36.390(2) |
| Connecticut | 09:00–20:00 | Conn. Gen. Stat. § 42-288a (P.A. 23-98) |

Each row carries its source URL in code. The federal window (08:00–21:00, 47 CFR § 64.1200(c)(1)) stays in `quiet-hours.ts` (recipient's zone). DST: window starts convert with the kernel zone helpers (gaps move forward, overlaps take the earlier instant); tests cover both 2026 Sunday switch days.

**WhatsApp channel** (`whatsapp` on `messages`, the platform `Notifier` port and `crm.consents`): a `WhatsAppTransport` port (`to`, `body`, template `category`) with memory and dev-mailbox fakes. The two real adapters (Cloud API, the owner's gateway) are M3.5b.

**SMS segment counting** (`policy/sms-segments.ts`): GSM-7 (160 / 153 per concatenated segment; extension characters take two septets and are never split) vs UCS-2 (70 / 67; surrogate pairs never split). Used for metering (`messages.segments`, `usage_counters.units`) and in the announcement preview. Texts are rendered by `smsText` (org name first, subject, the message, link, and "Reply STOP to opt out." for optional categories, in 13 locales).

**Usage metering and quotas**: `usage_counters` per org × month × channel (messages, units = SMS segments or messages), incremented on every send. Defaults (placeholders, pending the owner): email 10,000, SMS 500 segments, WhatsApp 500, push 50,000 per month (`policy/config.ts`). Staff set per-org limits (`setQuotaLimitCommand`, `platform:messaging.quota`, audited `messaging.quota.set`). The organizer sees usage, limits, "Quota reached" and how many messages wait on **Messaging limits** (`/o/{org}/messaging`) and in the announcement preview.

**Complaint-rate auto-pause** (`evaluateComplaintRateTx`, run by `recordDeliveryEventsCommand` when a complaint arrives): complaints ÷ **optional** emails sent (reminders, updates, marketing: what the pause stops; a spam click on a ticket email does not count) over the last 30 days **and since the org's last auto-pause** (a lifted org starts clean); with ≥ 100 such emails and **strictly above 0.3 %**, it inserts the org's `pause_messaging` suspension (so every sender and the M1.10 gate already honour it; transactional mail keeps going), records `auto_pauses` (the numbers), emits `org.suspension_changed@1` and `messaging.auto_paused@1`, and notifies owners and admins (`messaging.auto_paused`, in-app + email, 13 locales). Staff see a count in the console header and the list **Auto-paused messaging** (platform_reader, access-logged), and lift it on the tenant's messaging page with a note (`liftAutoPauseCommand`, `platform:messaging.auto_pause.lift`, audited `messaging.auto_pause.lift`). The organizer sees a banner with the rate on Messaging limits.

**Preference center** (`/preferences/{org}/{token}`, no account; link from the unsubscribe page): email per category (reminders, event updates, news and offers), a mobile number, and SMS / WhatsApp × (reminders and updates, news and offers) with the text-consent disclosure next to the boxes. Email categories are the unsubscribe list; text and marketing-email choices are consent-ledger rows with evidence (`preference_center:text-consent-v1:{channel}:{purpose}:{last 4 digits}`); only changes are written; a new number re-records the consents that are on. The token is an HMAC of the contact id bound to the org (`notifications.preferences:{org}`). One-click unsubscribe (RFC 8058) is unchanged. `savePreferenceCenterCommand` is audited (`notifications.preference_center`, the list of changes, never addresses).

**Lifting a suppression** (Messaging limits → Suppressed addresses): bounce suppressions can be lifted by roles with `org:update` with a note (`liftAddressSuppressionCommand`, audited `notifications.suppression.lift` without the address); complaints are refused (`complaint_not_liftable`, "Only Yayatoh support can lift this"). Addresses are masked.

**Announcements by SMS**: the composer offers SMS; the preview shows the text, its characters, segments and encoding, how many attendees have a number, and a quota warning; the sent log breaks "not sent / waiting" down by channel and reason.

**Frequency caps** are editable by owners/admins on Messaging limits (1–20 messages per 1–720 hours per scope; audited `messaging.caps.set`); others see them read-only.

### 3. Data model
| Table | Change | Notes |
|---|---|---|
| `notifications.messages` | add `contact_id`, `recipient_region`, `recipient_key`, `segments`; channel `whatsapp`; index `(org_id, recipient_key, sent_at) where status = 'sent'` | `recipient_key` = HMAC(APP_TOKEN_SECRET, channel + address), so caps count without a readable phone column |
| `notifications.usage_counters` | new tenant table | unique `(org, period, channel)` |
| `notifications.quota_limits` | new tenant table | unique `(org, channel)`, staff-set |
| `notifications.frequency_caps` | new tenant table | unique `(org, scope)` |
| `notifications.auto_pauses` | new tenant table | lift fields all-or-nothing (CHECK) |
| `crm.consents` | channel `whatsapp`; purpose `informational` | |
| `messaging.announcements` | channel `sms` | |

All new tables: `tenantTable()` (FORCE RLS, NULLIF policy, org-leading indexes), fixture rows for both orgs in `createOrgFixture`.

#### Hand-written SQL (migration 0054, between `-- hand-written: begin/end`)
1. CHECKs on existing tables re-added `NOT VALID`, then `VALIDATE CONSTRAINT`: `crm.consents.consents_channel_check`, `consents_purpose_check`; `messaging.announcements.announcements_channels_check`; `notifications.messages.messages_recipient_region_check`, `messages_segments_check`, `messages_channel_check`, `messages_address_check`. (drizzle-kit generated the matching `DROP CONSTRAINT`s above the block.)

### 4. Acceptance
| Criterion | Test |
|---|---|
| SMS without consent is blocked with a reason (roadmap) | `packages/testing/tests/messaging-policy.int.test.ts` "a marketing SMS without express written consent is blocked with a reason…", "event updates by text need consent…"; e2e `apps/web/e2e/messaging-policy.spec.ts` "…a text without consent is blocked with its reason; after opting in it is sent" |
| Texas Sunday quiet hours are respected (roadmap) | unit `packages/modules/notifications/tests/policy.test.ts` (Texas weekday/Sunday, DST spring-forward and fall-back Sundays, El Paso, address vs number, Florida panhandle, Oklahoma 8 p.m.); int "Texas Sunday: a text at 10:00 waits for noon, then sends" |
| A complaint rate above 0.3 % auto-pauses the org (roadmap) | unit (exactly 0.3 % does not, volume floor); int "above 0.3 % the org pauses…" (owner told, event emitted, optional held / tickets sent, staff-only lift with note, audited, no re-pause from old mail); admin e2e `apps/admin/e2e/messaging-policy.spec.ts` |
| WhatsApp category; US marketing WhatsApp blocked | unit; int "WhatsApp: utility goes out with consent; marketing to a US number is blocked" |
| Segment counting (GSM-7 / UCS-2, concatenation) for metering and preview | unit (160/161, 153, extension chars, UCS-2 70/67, emoji pairs); int "SMS usage counts segments"; e2e preview "1 segment (GSM-7)" |
| Frequency caps with deferral/skip reasons | unit; int "a fourth event update in a day waits; marketing … is skipped"; "owners set caps within bounds; viewers are refused; audited"; e2e "frequency caps" |
| Quotas hold, never drop; staff-set limits; organizer sees "quota reached" | int "over-quota optional messages are held…"; e2e "quota reached…"; admin e2e (set/reset a quota) |
| Preference center; one-click unsubscribe kept | int "preference center" (masking, per-org token, validation, ledger evidence, audit, unsubscribe link); e2e (keyboard, validation, persistence, Arabic) |
| Lift a suppression (audited); complaints support-only | int "address suppressions…"; e2e "the organizer lifts a bounce with a note; a complaint is support-only" |
| Tenant isolation of the new tables | `packages/testing/tests/isolation.int.test.ts` (fixture rows in both orgs) plus cross-org checks in the int suite |

**Gate (2026-09-28):** `pnpm verify` green (876 unit, 594 integration). Web e2e on a fresh database: 952 passed, 10 skipped, 4 failed — the same 4 fail on the base commit without M3.5a (`receivables.spec.ts:10` ×3, `ai-draft.spec.ts:171` desktop). Admin e2e: 22 passed.

### 5. Pending the owner
- **Quota numbers** (placeholders): email 10,000 · SMS 500 segments · WhatsApp 500 · push 50,000 per org per month; transactional messages are never held by a quota (still counted).
- **Frequency-cap defaults**: reminders 3/24 h, event updates 3/24 h, news and offers 2/7 days, all optional 5/24 h per recipient per channel.
- **Complaint auto-pause**: 30-day window, ≥ 100 optional emails, strictly above 0.3 %, counting complaints about optional email only (found at the gate: the M1.10d e2e marks a ticket email as spam on the shared demo org, and counting it paused that org for the rest of the suite; SES itself counts all mail, so say if tickets should count); it uses the existing `pause_messaging` kill switch (transactional mail keeps going).
- **TCPA counsel**: the state table, and the reading applied here (state hours for every non-urgent text, not only marketing; consent to informational texts for reminders/updates by text; all +1 numbers treated as US for WhatsApp marketing; the disclosure wording `text-consent-v1`).
- **Organizers can lift bounce suppressions, not complaints** (support only).

### 6. Later / not yet
- M3.5b: SES / Twilio / WhatsApp adapters (Cloud API + gateway), inbound STOP/HELP handling (withdraws consent in the ledger), fallbacks (WhatsApp → SMS, push → email), per-tenant sending domains and 10DLC.
- Push choices in the preference center (push preferences stay per member account); the email footer linking straight to the preference center (it is reached from the unsubscribe page).
- Staff lifting complaint suppressions; staff alerts routed by email/Slack (the alert engine, M3.2b, consumes `messaging.auto_paused@1`).
- Holiday rules (states that ban holiday calls), and a full NANPA area-code table (only the rule states' codes are listed).
- A contact-address field in crm (the gate reads `to.region` when a sender knows it).

## M3.5b — provider adapters (built)

Migration: `packages/db/drizzle/0076_handy_william_stryker.sql` (to be renumbered at merge): three new tenant tables and one platform table in `notifications`, three columns on `notifications.messages`, widened CHECKs on `notifications.address_suppressions` (hand-written block below).

### 1. Goal and users
Messages leave through the real providers the moment the owner's accounts exist, with nothing faked in between: organizers send email from their own domain, texts go through a 10DLC-ready Twilio service, WhatsApp goes through the Cloud API for new tenants and the owner's gateway for existing flows (decision P3-2). Every provider report is verified and counted once; a message that can't reach someone on one channel reaches them on the next, once; a STOP is honoured in the consent ledger; staff see each provider's health and what is left to switch it on.

### 2. What was built
**Adapters** (`packages/modules/notifications/src/providers/`, `node:crypto` only, an injected `fetch`; selected by config names in `.env.example`, live only when switched on **and** fully configured — `providerMode`; `select.ts` builds the worker's transports and the web's webhook adapters):

| Provider | Sends | Webhook verification | Maps |
|---|---|---|---|
| Amazon SES v2 (`ses.ts`, `sigv4.ts`) | `SendEmail` signed with SigV4 (the AWS test-suite vectors reproduce), configuration set, message tags `yayatoh-message` (our id) and `yayatoh-org`, List-Unsubscribe headers kept; the org's verified domain as From | SNS (`sns.ts`): certificate URL must be HTTPS on `sns.<region>.amazonaws.com` and end `.pem`, certificate issued to `sns.amazonaws.com` and valid (cached per URL), signature v1 SHA1withRSA / v2 SHA256withRSA over the canonical string, topic in `SES_SNS_TOPIC_ARN`, older than 1 h refused (replay); SubscriptionConfirmation visited only on an SNS host | Delivery → delivered; Bounce Permanent → hard, Transient/Undetermined → soft; Complaint → complained; other event types and untagged mail ignored. Event id = SNS MessageId |
| Twilio (`twilio.ts`) | Messages API through a Messaging Service (the org's verified 10DLC service, else the platform's), `StatusCallback` = `/api/webhooks/sms/twilio?m=<our id>`; 21211/21614 → invalid number, 21610 → opted out, other 4xx → refused, 429/5xx → retry | `X-Twilio-Signature`: base64 HMAC-SHA1 of the public URL (query included) + sorted form fields of the raw body (Twilio's documented example reproduces); JSON bodies via `bodySHA256` | delivered; undelivered/failed → hard (21211, 21614, 21610, 30004–30006) or soft; sender-side errors (30007, 30032–30036: 10DLC/filtering) produce no event (the number is not at fault). Event id = `sid:status` (a replay is a duplicate) |
| WhatsApp Cloud API (`whatsapp.ts`) | Template messages (`yayatoh_update` utility, `yayatoh_news` marketing, `yayatoh_code` authentication; body params = org name, text; 13 languages mapped), `biz_opaque_callback_data` = our id; the org's phone number id or the platform's; 131026 → not on WhatsApp | `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret); GET subscription check answers only the verify token | delivered/read → delivered (one event); failed 131026 → hard, template/account/limit errors → none, others → soft; inbound text/button STOP/START/HELP → keywords |
| Owner's gateway (`whatsapp.ts`) | `POST {WHATSAPP_GATEWAY_URL}/v1/messages` with `reference` = our id, signed `x-pani-key` / `x-pani-timestamp` / `x-pani-signature: v1=HMAC-SHA256(secret, "ts.body")` (contract pending the owner) | the same signature on callbacks, ±5 minutes (replay), key id checked | delivered/read, failed (`not_on_whatsapp`/`invalid_number` hard), inbound keywords |

`routedWhatsAppTransport` is the one WhatsApp port: the org's route (staff-set) else the first of `WHATSAPP_PROVIDER`. Fakes stay: `memoryTransports` (tests; now able to refuse numbers like 131026/21614 and to fail a channel) and the dev mailbox (dev/CI).

**One webhook pipeline** (`webhooks.ts` → `handleProviderWebhook`): verify on the raw body (256 KB cap) → count in provider health (verified / refused with the failure kind) → each delivery event recorded in **its org from our message id** (SECURITY DEFINER `message_org`) by `recordDeliveryEventsCommand` (dedup by `(org, provider, provider event id)`) → inbound keywords. Web endpoints (`apps/web/src/server/delivery-webhooks.ts`): `POST /api/webhooks/email/{ses|fake}`, `POST /api/webhooks/sms/twilio` and `/sms/twilio/inbound` (TwiML back; HELP gets the help text), `GET|POST /api/webhooks/whatsapp/{cloud|gateway}`; anything not live is a 404; failed verifications are rate-limited (M1.14 `webhookAbuse`). The public URL Twilio signs is built from `BETTER_AUTH_URL`, never a Host header. The dev drain posts the fake provider's reports through the same pipeline.

**Fallback chains** (`fallback.ts`, per category, pending the owner): transactional, reminders, event updates: WhatsApp → SMS → email; marketing: none; team alerts: push → email. Triggers are reachability only: `no_address`, `not_on_whatsapp`, `invalid_number`, `bounced` (a suppressed address), `no_device`, `provider_error` (a permanent refusal or the fifth failure), `undelivered` (a text's failed delivery webhook). Never for consent, opt-outs, unsubscribes, preferences, erasure or holds — an SMS-only announcement to someone without text consent stays blocked (M3.5a). The next channel's row reuses the dedupe key (so the unique `(org, channel, dedupe_key)` makes it idempotent across providers, retries, concurrent dispatchers and webhook replays), records `fallback_of` and `fallback_reason`, and runs the whole policy gate again; a channel that already has the message ends the chain; unreachable channels are skipped (SMS rows find the email through the crm contact). A failure and its fallback commit in one transaction.

**Inbound keywords** (`inbound.ts`, `keywords.ts`): STOP, STOPALL, QUIT, END, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE (alone, any case) / START, UNSTOP, YES / HELP, INFO; Twilio's `OptOutType` wins. The orgs come from `notifications.inbound_orgs` (SECURITY DEFINER): the org whose dedicated sender was reached, else every org without its own number that texted that number (matched by `recipient_key`, the HMAC the caps use). Per org, once per provider message (`inbound_keywords`): STOP withdraws marketing and informational consent on that channel for every contact with the number (evidence `keyword:STOP:{provider}:{id}`) and suppresses the number (`opt_out`, every text including transactional; organizers can't lift it: "Only the person can lift this, by replying START"); START lifts it and restores informational consent only; HELP answers "{Org} via Yayatoh: event messages. … Reply STOP to opt out. Help: {MESSAGING_HELP_URL}". Audited without the number. A dispatch refused with 21610 is `failed/opted_out` (no fallback).

**Sending setup** (`senders.ts`; organizer page `/o/{org}/sending`, nav "Sending setup"): the org's email sending domain (one per org, one org per domain platform-wide; reserved Yayatoh hosts refused): add → the identity port creates the SES identity (Easy DKIM, custom MAIL FROM `bounce.{domain}`) and DMARC is looked up (the domain, then its organizational domain); the page shows DKIM / SPF / DMARC (with the policy), the DNS records to publish (a suggested `p=none` DMARC record when missing), "Check DNS now", "Remove domain". Mail uses `notifications@{domain}` only while DKIM and SPF are verified. Text senders (read-only for the org): the SMS sender (shared, or the org's number with its 10DLC campaign status: verified / in review / rejected / not registered) and the WhatsApp route; the fallback table. Everyone with `org:read` sees it; `org:update` changes it (viewers see it read-only and are refused). Development uses the fake identity port (`fail` label → DKIM failed, `pending` → stays pending, `nodmarc` → no DMARC).

**Staff console**: **Messaging providers** (`/providers`, staff `admin`/`support`): per provider the mode (live / configured but not switched on / not set up / development fake), last webhook, 24-hour verified and refused webhooks, sends and errors with the error rate, the last error code; then each real provider's switch-on checklist (config names — names only — webhook seen, switched on, and the owner's steps). Read through platform_reader (access-logged). Tenant → Messaging → **Dedicated senders**: a Twilio Messaging Service SID (saved with its 10DLC status as Twilio reports it now; fake in dev: a SID ending `f` failed, `e` in review) and a display number; the WhatsApp route (Cloud API with a phone number id, or the gateway); back to shared. `setChannelSenderCommand` (`platform:messaging.senders`, audited `messaging.sender.set` with the last four characters only).

**Provider health** (`provider-health.ts`): `notifications.provider_health` counters per provider × UTC hour, written through `notifications.record_provider_health` after the tenant transaction (so a hot hour row never serializes orgs); the dispatcher records `messages.provider` for every send.

### 3. Data model
| Table | Change | Notes |
|---|---|---|
| `notifications.sending_domains` | new tenant table | unique `(org)` and `(domain)` (platform-wide, like `tenancy.org_domains`); statuses per check; `verified` iff DKIM and SPF verified (CHECK); records = public DNS data |
| `notifications.channel_senders` | new tenant table | unique `(org, channel)`; unique `(provider, sender_ref)` platform-wide (inbound routing); CHECK: SMS = Twilio + `MG…` + campaign status, WhatsApp = cloud + numeric id or gateway |
| `notifications.inbound_keywords` | new tenant table | unique `(org, provider, provider_event_id)`; the number only as `recipient_key` |
| `notifications.provider_health` | new **platform** table (GLOBAL_TABLES) | PK `(provider, hour)`; no app_user privileges; platform_reader SELECT |
| `notifications.messages` | `provider`, `fallback_of` (self composite FK), `fallback_reason`; indexes `(org, fallback_of)` and `(recipient_key, org)` for texts | CHECKs on provider and fallback reason |
| `notifications.address_suppressions` | channel `whatsapp`; reason `opt_out`; numbers for SMS and WhatsApp | |

Fixture rows for both orgs in `createOrgFixture` (a verified sending domain, dedicated SMS and WhatsApp senders derived from the org id, an inbound STOP). Column privacy: `sending_domains.domain`/`records` public (they appear in every From line / public DNS), `channel_senders.sender_ref` secret (never in a DTO but its last four characters), `inbound_keywords.provider_event_id`/`recipient_key` secret; `address_suppressions.address_norm` is personal for email rows (text rows are shown masked).

#### Hand-written SQL (migration 0076, between `-- hand-written: begin/end`)
1. CHECKs and the FK on existing tables re-added `NOT VALID`, then `VALIDATE CONSTRAINT`: `address_suppressions_channel_check`, `address_suppressions_reason_check`, `address_suppressions_address_check`, `messages_provider_check`, `messages_fallback_check`, `messages_fallback_fk` (drizzle-kit generated the matching `DROP CONSTRAINT`s above the block; its plain `ADD CONSTRAINT`s were moved into the block).
2. `REVOKE ALL ON notifications.provider_health FROM app_user, platform_reader`; `GRANT SELECT … TO platform_reader`.
3. `notifications.record_provider_health(text, text, text)` SECURITY DEFINER → `app_user` (upsert of the hour's counters).
4. `notifications.inbound_orgs(text, text, text, text)` SECURITY DEFINER → `app_user` (org ids only).
The two new indexes on `notifications.messages` are built in the migration transaction (fine before launch; after launch they would be `CONCURRENTLY` in their own migration, as noted in 0064).

### 4. Acceptance
| Criterion | Test |
|---|---|
| Provider webhooks verified (incl. wrong / missing / replayed) | unit `packages/modules/notifications/tests/providers.test.ts`: SNS v1/v2, wrong key, tampered, missing, >1 h replay, foreign topic, certificate host/subject/expiry, SubscribeURL host; Twilio documented vector, wrong token, missing, re-targeted URL, tampered, JSON `bodySHA256`; Meta `X-Hub-Signature-256` wrong/missing/malformed/tampered and the verify-token challenge; gateway wrong/missing/other key/>5 min replay |
| …and deduplicated | int `packages/testing/tests/providers.int.test.ts`: SES bounce delivered 4× (3 concurrent) records once; Twilio callback ×4 concurrent records once and falls back once; WhatsApp status ×3 falls back once; inbound STOP retried applies once |
| Webhook → delivery status / suppression / consent | int: SES hard bounce → `bounced` + suppressed, next ticket suppressed; complaint; Twilio undelivered 30006 → hard suppression; WhatsApp 131026 → WhatsApp suppression and later messages fall back at once; STOP → consent withdrawn with evidence, `opt_out`, ticket texts suppressed `opted_out`, not liftable by the org; START → informational back, marketing still withdrawn; HELP names the org on its own number, not on the shared one |
| Fallback decisions and idempotent fallback | unit (chains, triggers, never for consent/opt-outs/holds, marketing none); int: WhatsApp → SMS under three concurrent dispatchers sends one SMS; a channel already queued ends the chain; WhatsApp → SMS → email with reasons recorded; provider outage falls back after the fifth attempt; marketing never escalates |
| SES / Twilio / WhatsApp send adapters and error mapping | unit (SigV4 AWS vectors, SES request/tags/From/RFC 2047, refusals vs throttling, identities + MAIL FROM, DMARC lookup; Twilio request/service/callback and codes; Cloud API templates/ids/codes; gateway signing; routing) |
| Config-only switch-on | unit "provider selection by config names"; e2e `sending-setup.spec.ts` "provider webhooks answer only for configured providers" |
| Org sending-domain settings (keyboard, validation, persistence, axe, Arabic RTL, viewer denied) | e2e `apps/web/e2e/sending-setup.spec.ts` (add/check/remove from the keyboard, DKIM/SPF/DMARC, records, mail then from the org's domain, failing DKIM, a domain taken by another org, viewer read-only + replayed action refused, Arabic); int "sending domains and dedicated senders" |
| Staff provider health and switch-on checklist; dedicated senders | e2e `apps/admin/e2e/providers.spec.ts` (health from real dev traffic, checklists, access log, keyboard, axe; SID validation, 10DLC status, WhatsApp route, the organizer's view in English and Arabic; finance staff and signed-out refused); `apps/worker/tests/provider-health.int.test.ts` (counts, access log, config names only, app_user has no table access) |
| Tenant isolation | `packages/testing/tests/isolation.int.test.ts` (fixture rows in both orgs for the three new tenant tables); int: events and suppressions stay in their org; a STOP to one org's number leaves the other org alone |

**Gate (2026-09-29):** `pnpm verify` green (1516 unit, 973 integration). Web e2e on a fresh database: 1425 passed, 34 skipped, 2 failed — both outside M3.5b and both pass on rerun (`tenant-account-corner.spec.ts:97` desktop: the tenant-site sign-in stayed on `/sign-in`; `tracked-links.spec.ts:323` desktop: `socket hang up` on `/api/dev/login` under load). The new specs (`sending-setup.spec.ts`, `messaging-followups.spec.ts`) 33/33. Admin e2e: 64 passed.

### 5. Pending the owner
- Accounts and switch-on per provider (SES production access and `mail.yayatoh.com`; Twilio toll-free + 10DLC; Meta business verification, templates; the gateway's API contract): `docs/owner-inbox.md` "Messaging providers".
- The fallback chains per category and the triggers (reachability only); STOP semantics (per org answered, or every org on the shared number; transactional texts blocked too; START restores informational only); the HELP text and `MESSAGING_HELP_URL`.
- The gateway's contract: the signing scheme implemented is our proposal.

### 6. Later / not yet
- Embedded Signup (tenants connecting their own WABA and tokens); SES tenants (per-org reputation isolation) and per-tenant configuration sets; a scheduled re-check of pending sending domains and 10DLC campaigns (today on "Check DNS now" / staff save).
- WhatsApp HELP replies (a session message needs the 24-hour window); push → email fallback for buyers (push rows exist only for opted-in devices).
- An index on `crm.contacts (org_id, phone_e164)` if STOP lookups grow; a platform-wide opt-out list across orgs on the shared number.
- The organizer's per-order message log showing the fallback chain ("sent by SMS after WhatsApp failed"); today it lists both rows with their reasons.

