# Spec: M3.5 — Messaging platform and compliance

- **Milestone:** M3.5 (roadmap §8 Phase 3 "M3.5 Messaging platform and compliance", §6.4 messaging pipeline, §10)
- **Status:** M3.5a built (owner approved the Phase 3 plan, 2026-09-28); M3.5b (provider adapters) later
- **Risk tags:** `db-migration`, `tenancy`, `legal-copy` (text-consent disclosure; state rules pending TCPA counsel)
- **Related ADRs / decisions:** D16 (sender of record; WhatsApp utility-only in the US; quotas until M6.6), 2026-09-28 "WhatsApp: one port, two adapters", 2026-09-28 "Messaging quotas per organization until paid plans"; M1.10 spec (dispatcher, categories, federal quiet hours, unsubscribe, suppressions, delivery events)

## M3.5a — policy gate v2 (built)

Migration: `packages/db/drizzle/0054_abnormal_black_widow.sql` (renumbered at merge): four new tenant tables in `notifications`, four columns on `notifications.messages`, changed CHECKs on `notifications.messages`, `crm.consents` and `messaging.announcements` (hand-written block below).

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
