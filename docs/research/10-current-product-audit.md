# Yayatoh Current

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** inferences from public surfaces. The code audit (docs/legacy/code-audit-2026-09-26.md) is authoritative.


## Topic

Audit of the current Yayatoh product from public surfaces (Phase 0 inventory for the Yayatoh 2.0 rebuild)

# Yayatoh — Current-Product Audit from Public Surfaces

Date of audit: 2026-09-26. Method: fetched yayatoh.com and abc.yayatoh.com pages, the public JSON endpoints their Vue front end calls, the embedded Ziggy route manifest (690 named Laravel routes), the UI label bundle (`/assets/js/eventmie_lang`, 1,461 keys), the App Store / Google Play listings, and the vendor (Eventmie Pro) documentation and open-source base. Nothing was written or changed. Items marked **UNVERIFIED** need confirmation from source code.

## 0. What Yayatoh actually is (key finding)

Yayatoh is a **customised Eventmie Pro FullyLoaded** installation (Classiebit's Laravel event-ticketing script), not a from-scratch Laravel app. Evidence: `css/eventmie-custom.css?v=4.1`, route names `eventmie.*`, Voyager admin (`voyager.*`, `/admin`, Voyager media paths `storage/settings/March2026/...`), `LaravelInstaller`/`LaravelUpdater` routes, `laravel-cookie-consent`, Cashier (`cashier.webhook`), Sanctum (`sanctum.csrf-cookie`), Socialite (`/login/{social}`), lab404 impersonate, Ziggy, Vue 2 (`vue.esm`, `vue2-editor`, `vue-slick-carousel`, `vue-select`), Bootstrap, Vite. Eventmie Pro 3.0 (23-Sep-2025) is Laravel 11 / PHP 8.3 with React Native 0.77 apps; 3.0.1 shipped 16-Feb-2026. The exact installed version is **UNVERIFIED** (check `composer.lock`).

On top of stock Eventmie Pro, Yayatoh has added a large custom layer (sections 1–4): ticket distribution, event attendees/guest import, public "Attendee Portal" seat finder, event access codes + private info portal, sessions/speakers/exhibitors/custom sections/announcements, event push/SMS notifications, 1-to-1 chat with moderation, magic-link and OTP login, kids/seated/standing guest counts, purchasable AI prompt credits, and per-ticket `access_dates` (multi-day pass entitlement).

**"Multi-tenant" today = one Laravel install per tenant.** `abc.yayatoh.com` (All Bamileke Convention Chicago 2026) has its own settings/logo, its own Ziggy base URL, its own event IDs (id 26–28 exist on both hosts with different content), its own blog posts used as CMS pages ("Become a vendor", "Book your hotel", "Sponsor"), "Powered by https://yayatoh.com" in the footer, and **its own white-label mobile app** (ABC Chicago 2026). There is also `staging.yayatoh.com` (HTTP 403 to the public; the Yayatoh iOS privacy-policy link points at it).

Legal entity: **Pani Digital Services, LLC**, 5000 Sunnyside Ave Ste 300, Beltsville MD 20705-2327; phones 240-200-6474 / 202-790-2928; info@yayatoh.com; developer contact fabrice@panidigital.com. Terms: Maryland law, AAA arbitration in Beltsville.

## 1. Feature inventory (grouped)

### 1.1 Discovery & public site
- Home: hero ("all-in-one event operating system … ticketing, seating, scanning, analytics, and team management"; "200-person gala to 20,000-attendee convention"), banner slider (Voyager `banners` with `app_event_slug`, `button_url`), category tiles, event slider (props `events`, `countries`, `currency`, `date_format`, `item_count`), venue cards with event counts, gallery, latest 3 blog posts, newsletter subscribe, app badges, theme switcher Light/Dark/Auto.
- `/events` listing (Vue `EventListing`, 12/page) via `GET /events/api/get_events` with params `category, city, state, country, search, price, start_date, end_date, date_range, page`; helpers `/events/api/categories`, `/events/api/cities`, `/events/api/search-events`, `/search-events`. Categories observed: Arts & Culture, Education & Classes (slug `panitech-academy`), Social Gatherings (slug contains a space), Business & Seminars (`business-&-seminars`), Charity, Travel & Leisure; each has `thumb`, `icon`, `template`, `status`, `events_count`. City/state data is free text and inconsistent ("MD" vs "Maryland").
- Event page `/events/{slug}`: title, category, excerpt, dates/times, venue + "Get Directions" (Google Maps chunk `GMap`), organizer block + "Contact Organizer", Overview (rich text), FAQ/highlights (`faq`), gallery (`images`), YouTube banner / video links, **Schedule** (date tabs + sessions with time range, title, thumbnail, badge text such as "By Invitation Only", "Additional Fee"), **Sponsors and Exhibitors** (exhibitor modal: description, team/staff, videos, website, contact, sponsor badge), **Notable individuals / Guest Artists** (speakers grouped by type; modal with biography + social), reviews (`show_reviews`), "Event and Refund Policy" link, booking-guide link, tag pages `/events/{slug}/tag_{tag}`, short URL `/e/{short}` (302), private events (password, hidden from listing), coming-soon, force-sold-out, on-sale timer, repetitive events (daily/weekly/monthly schedules, `merge_schedule`), online events (`online_location`, secret shown after purchase), JSON-LD `Event` schema. A "find my seat" widget (`PublicSeatSearch` chunk) is loaded on event pages.
- Organizer public profile `/{organisation_url}` (root-level catch-all; e.g. `abc.yayatoh.com/iba`), with bio, social links, avatar, ratings, events list, contact form (`/api/v2/organiser-mail`).
- Venues `/venues`, `/venues/{slug}`: `venue_type`, address, city/state/zip, `glat/glong`, image gallery, description, capacity/amenities in rich text, events at venue, "Request quote" (`/venues/request_quote`).
- Blog `/blogs` (Voyager posts, 17 posts, 12/page, `?sort=id&page=N`), `/blogs/{slug}`. CMS pages `/pages/{slug}` (terms, privacy, booking-guide), `/about-us`, `/features`, `/faq`, `/contact` (+ wa.me WhatsApp link).
- Theme: light/dark/auto; cookie consent banner with preference categories.

### 1.2 Event creation & management (organizer dashboard `/dashboard`)
- Multi-step event form `/dashboard/myevents/manage/{slug?}` with independently saved steps stored in `is_publishable` JSON: detail, timing, tickets, location, media, SEO (`store`, `store_timing`, `store_location`, `store_media`, `store_detail_media`, `store_seo`, `store_event_tags`, `publish_myevent`). Rich text editor with image upload; poster (16:9) + thumbnail; tags (`/dashboard/mytags`); venues (`/dashboard/myvenues`, Google Places autocomplete); clone event (`/clone/events/{event}`); delete; export attendees CSV ("Download Guest List").
- AI event creation: OpenAI generates title/description/SEO/FAQ (`/openai/openai-prompt`), plus **purchasable prompt credits** (`/openai/purchase-prompts`, `remaining-prompts`, `fund/callback`) — custom monetisation.
- Event settings observed in JSON: `price_type`, `featured`, `is_private`, `coming_soon`, `e_soldout`, `show_reviews`, `scan_on_event_day_only` ("Early Check-in"), `enable_public_seating`, `offline_payment_info` (free text, e.g. Zelle instructions), `e_admin_commission` (event-specific commission %), `currency_id`, `short_url`, `item_sku`, `merge_schedule`, `online_location`, `seatingchart_image`, `meta_*`, `youtube_banner`, `video_link` (JSON array), `latitude/longitude`.
- Conference-style sub-modules (custom): **Sessions** (`/myevents/sessions/*`, thumbnails at `storage/session_thumbnails/`), **Speakers**, **Exhibitors** (with sponsor badge, staff, videos, contact), **Custom sections** with items and active toggles ("Why Join", FAQs), **Announcements** (types incl. Speaker Change; creating an active announcement pushes to attendees), **Private info** (`/myevents/private-info/*`: wifi, shuttle, parking, contact, notes, program, visuals, custom sections → the "Event Code Portal").
- Event access codes (`/dashboard/event/{id}/codes/*`): create/edit/delete, max uses, expiry, active flag, per-code stats and attendee list.
- Event notifications (`/dashboard/event/{id}/notifications/*`): send push / in-app / SMS to attendees, history, delete.
- Message reports moderation (`/dashboard/event/{id}/reports/*`): review, dismiss, warn user, block user, delete message.

### 1.3 Ticketing, checkout, orders
- Ticket types per event: `title, price, quantity, description, thumb, status, order (sequence), customer_limit ("Booking Limit per Customer"), t_soldout, sale_start_date/sale_end_date/sale_price (early-bird window), is_donation ("choose-your-amount"), is_multi_day, access_dates [{date,name}]` (custom: which days a pass admits, e.g. "Cultural Night", "Gala Night"), taxes per ticket. Free tickets ("Free Checkout" label mapped to RSVP), complimentary bookings in bulk with `bulk_code`, custom ticket ordering.
- Checkout popup on event page (`select-dates` for multi-day, `booked_tickets` keyed `ticketId-date`, `max_ticket_qty` per order = 200 on ABC, `total_capacity`), 8-minute reservation timer (site copy; Eventmie doc says 5 min — **UNVERIFIED** actual), guest checkout (auto-creates account, optional email OTP), login/register inside popup, attendee details per ticket (attendee custom fields), promo codes (`/promocodes/apply`, organizer-managed, per-ticket), taxes (admin fixed/percent + organizer taxes), multi-currency (`/currencies`, per-event currency), seated/standing guest counts ("How Many Guests?", `/update-kids-count`).
- Payment methods: Stripe (Checkout + 3DS `extra/authentication`, Cashier webhook `/stripe/webhook`), Stripe Connect Standard for organizer payouts (`/connet/stripe` — note typo — and `/profile/disconnect-stripe`), PayPal (`/bookings/paypal/callback`), offline payment (organizer/customer toggles, instructions text), plus dormant gateway routes shipped with Eventmie (Razorpay, Paytm, MercadoPago, Flutterwave, Paystack, BitPay, Authorize.net) and two non-stock callbacks: `/checkout/mesdoh/callback` and `/api/v2/qPay/*` (**UNVERIFIED** purpose; possibly mobile-money for the Cameroonian diaspora audience). `/test-payment` route is live in production.
- Orders: one booking row per ticket, grouped by `order_number` and `common_number` (`/download-multiple/tickets/{id}/{common_number}`), `is_paid`, booking status enabled/disabled, cancellation workflow (customer request → organizer/admin approve → manual refund → status Refunded), failed bookings module (`/dashboard/failed-bookings`, `/check-all/failed-bookings`, admin `make_booking` from failed order), resend booking email, invoice PDF with seller info/tax info/signature (`/invoice/download/bookings/{id}`), ticket PDF with QR (`/download/ticket/{id}/{order_number}`), "Disable Ticket Download" setting, Google Calendar link.

### 1.4 Ticket distribution (custom, flagship)
- Buyer side `/mybookings/distribute/{booking}`: assign each ticket to a named recipient (name/email/phone), assign a seat per recipient, update names, send via WhatsApp (`send-whatsapp`), download all, distribution status; recipients see `/mybookings/received-tickets`; `/distribute-seats` page; magic-link login (`/magic-login/{token}`, `users.magic_login_token/expires_at`) for recipients — **UNVERIFIED** that magic links are what distribution emails use.
- Organizer side `/myevents/distributions`: distribute on behalf of a buyer, revoke, delete, detail, update recipient name, **update association** (distributor tag — used for association-sold VIP blocks, sponsor/partner/media/VIP comp accountability), send WhatsApp. Bulk ticket creation `/myevents/bulk-tickets/create`; admin bulk export CSV / zip of QR PDFs.

### 1.5 Attendee management & guest import (custom)
- `/myevents/attendees/*`: list, add single, bulk add, **import** (CSV/Excel), assign seat, get available seats, update label/tag, check in, undo check-in, delete booking; `/attendee/add/attendee`; export CSV. Labels: "Guest List", "Add to Guest List", check-in timestamps.
- Eventmie guest lists (`/dashboard/myglists/*`): named lists, guests (name/email), add event attendees to a list, export emails, bulk email to a list or all.

### 1.6 Seating & seat finder
- Image-based seat chart **per ticket type** (upload chart image, click to place seats, right-click rename, max seats = ticket quantity, enable/disable seat or whole chart, delete seats by chart): routes `/seatschart/upload`, `/seats/save|disable|enable|delete`, `/seats/delete/all/seats`, `/seatschart/delete_seats_by_chart`, `/seatschart/disable_enable_seatchart`, `/events/get_by_date` (chart per date), `/api/v2/seat_status`, `/myevents/delete/seatchart`, event column `seatingchart_image`. Seat hold during checkout; seat printed on ticket PDF. Storage format (x/y % coordinates per seat row) is **UNVERIFIED**.
- **Attendee Portal / seat finder** `/events/{slug}/attendee` ("Look up your ticket details, check your status, and manage your seat"): name/email search (`/attendee/search`), email OTP request/verify, `direct-auth`, `seat-data`, `select` (self-service seat pick), `check-attendance`; organizer toggle `enable_public_seating` and printable QR poster `/myevents/download-public-qr/{slug}` (kiosk/table signage use).

### 1.7 Check-in, scanning, fraud controls
- Web scanners `/scan-ticket-camera` and `/scan-ticket-laser` (USB/Bluetooth Zebra/Honeywell), `/verify-checkin`; API twins `/api/v2/scan-ticket-camera|laser`, `/api/v2/verify-checkin`. Modes: Auto vs Manual, "Check-In One" vs "Check-In All" (scan one QR to check in a whole party). Colour feedback green/orange/red; messages: already checked in, not authorized for this event, "Tickets cannot be scanned before the event starts", event-day-only. QR encodes ticket id + order number + link (vendor doc). Per-attendee check-in for multi-ticket orders; check-in history/timestamps; scanner dashboard `/scanner-dashboard` (event totals, monthly revenue); Scanner-role booking list. Access by ticket type / `access_dates` gating (**UNVERIFIED** enforcement in scanner).
- "Fraud detection" as marketed = duplicate-scan detection + unpaid-booking scan block + event-window validation + chat "Scam/Fraud" report reason. No dedicated fraud engine found. Offline scanning is claimed on `/features` ("Data auto-syncs once connectivity is restored") but no offline mechanism exists in vendor docs — **UNVERIFIED**; must be confirmed in app source.

### 1.8 Team & roles
- Sub-organizers per event (`/dashboard/sub_organizers`, `organizer/create/user`, `save/sub/organizers`) with roles **Manager** (full organizer rights on assigned events), **POS** (sell at door with offline payment, POS dashboard `/pos-dashboard`, `/dashboard/pos-bookings`), **Scanner**. Admin impersonation ("Login as Customer/POS/Scanner/Manager").

### 1.9 Venues
- Organizer-owned venues (`organizer_id`), venue search/select in event form, venue images, request-quote leads, admin BREAD.

### 1.10 Analytics & reporting
- Organizer: dashboard totals (`/dashboard/event/total`), monthly revenue, earnings (`/dashboard/myearning/*`), bookings with customer search, complimentary bookings, failed bookings, code statistics, notification history, check-ins. Admin: sales report, event report export, commissions & settlement ("Transferred" checkbox), event total by sales price. Exports CSV.

### 1.11 Communications
- Email (Blade templates in `resources/views/email_templates/`), SMS via Twilio, WhatsApp send for distribution (mechanism **UNVERIFIED**: Twilio WhatsApp vs wa.me deep link), push (FCM `fcm_token`, APNs `apn_token` on users; `/api/v2/update-fcm-token`), in-app notifications (`/notifications/*`), event announcements, bulk email to guest lists, newsletter subscribers, Mailchimp per organizer (`mailchimp_apikey/list_id`), contact-organizer mail, organiser↔customer two-way messaging (Eventmie 3.0), **1-to-1 attendee chat** (`/api/chats/*`: create, messages, read, typing; report message; block/unblock; `/chat-event`), attendee directory per event code (`/event-code/{id}/attendees`).

### 1.12 Accounts & auth
- Register (name/email/password), login (+remember), Google OAuth, Apple (`users.apple_id`, app), email verification, password reset, **OTP login** (`/api/v2/send-otp`, guest OTP), magic login, guest register, "Become organiser" role upgrade (one-way), profile (organisation, bank details, seller/tax info + signature, Mailchimp, Stripe Connect), GDPR consent/cookie, account deletion via support only.

### 1.13 i18n
- 13 locale codes: ar, de, en, es, fr, hi, it, ja, nl, pt, ru, zh_CN, zh_TW via `/lang/{code}` (cookie + `users.settings.locale`); UI strings served from `/assets/js/eventmie_lang` (1,461 `em.*` keys); RTL for Arabic; date/time formats from settings; timezone America/New_York with per-user local timezone (`/set/local_timezone`). Direct hit on `/lang/fr` returned HTTP 500 (cause **UNVERIFIED**, likely missing referer).

### 1.14 Admin (Voyager)
- BREAD for banners, bookings (+bulk), categories, commissions, contacts, currencies, events, menus, newsletter subscribers, pages, posts, promocodes, roles, settings, tags, taxes, users, venues; media manager; database/BREAD builder; compass; settings tabs (Site, AI, Storage local/S3, SEO, Social, Contact, Booking, Multi-vendor, Admin, Payments, Apps, Mail, Regional).

### 1.15 SEO state
- JSON-LD Event schema on event pages (bug: `addressCountry` emits country id "231"); OG/Twitter meta (bug: `og:image` is a relative path); **no** `robots.txt`, **no** `sitemap.xml`, no canonical, no hreflang; Google Analytics only in production template; meta keywords list targets "reserved seating software", "VIP table management", "gala ticketing software".

## 2. User roles observed
| Role | Where seen | Notes |
|---|---|---|
| Admin (super) | `/admin` Voyager, impersonate, commissions, settlement | Yayatoh staff |
| Organiser (`role_id`=3) | `/dashboard` | Owns events, venues, tags, sub-organizers; Stripe Connect; cannot buy others' tickets |
| Manager (sub-organizer) | `/dashboard`, assigned events | Full organizer actions on assigned events |
| POS (sub-organizer) | `/pos-dashboard`, `/dashboard/pos-bookings` | Door sales, offline payment, own bookings only |
| Scanner (sub-organizer) | `/scanner-dashboard`, web/app scanners | Scan + view scanned bookings |
| Customer | `/mybookings`, `/my-events`, chat | Buyer; can become organiser |
| Guest customer | guest checkout | Auto-created account, OTP optional |
| Ticket recipient | `/mybookings/received-tickets`, magic login | Receives distributed ticket; may not have password |
| Attendee-portal visitor | `/events/{slug}/attendee` | Email OTP / direct auth, no account needed |
| Code-joined attendee | `/join-event`, `/event-code/*` | Access to private info, attendee directory, chat |
| Exhibitor / Speaker / Sponsor | event page modals | Content records only; the "self-service exhibitor portal" on `/features` has no visible login — **UNVERIFIED** |

## 3. Inferred data entities (from live JSON + routes + vendor base)
- `users` (observed columns): id, name, first_name, last_name, job_title, company, location, bio, social_links (JSON), profile_visibility, email, apple_id, organisation_url, email_verified_at, magic_login_token/expires_at, fcm_token, apn_token, stripe_id, pm_type, pm_last_four, trial_ends_at, avatar, settings (JSON: locale), role_id, organisation, bank_* (7 fields), address, phone, status, org_description, org_facebook/instagram/youtube/twitter/website, mailchimp_apikey/list_id, stripe_account_id, organizer_id (parent for sub-organizers), taxpayer_number, seller_name/info/tax_info/signature/note, country, city, pincode, ip_address, deleted_at.
- `events` (observed): id, title, description, private_info (JSON), faq, thumbnail, poster, youtube_banner, images, video_link, venue, address, city, state, zipcode, country_id, start/end_date, start/end_time, repetitive, repetitive_type, featured, status, meta_title/keywords/description, category_id, user_id, add_to_facebook, slug, enable_public_seating, price_type, latitude, longitude, item_sku, publish, is_publishable (JSON), merge_schedule, online_location, seatingchart_image, excerpt, offline_payment_info, e_admin_commission, short_url, currency, currency_id, e_soldout, show_reviews, coming_soon, is_private, scan_on_event_day_only.
- `tickets` (observed): id, event_id, title, price, quantity, description, thumb, status, is_multi_day, access_dates (JSON), customer_limit, t_soldout, sale_start_date, sale_end_date, sale_price, is_donation, order. Pivot `ticket_taxes` (**UNVERIFIED**).
- `venues` (observed): id, title, description, venue_type, slug, address, city, country_id, state, zipcode, glat, glong, images (JSON), organizer_id, status; pivot `event_venue`.
- `categories` (observed): id, name, slug, status, thumb, icon, template. `countries` (id, country_code, country_name). `banners` (title, subtitle, image, status, order, button_url, button_title, app_event_slug).
- `bookings` (base + Pro, **UNVERIFIED** exact): customer_id, organiser_id, event_id, ticket_id, quantity, price, net_price, status, order_number, common_number, event_title/dates/times/category, ticket_title/price, customer_name/email, is_paid, payment_type, transaction_id, currency, promocode/reward, tax_data, admin_commission, organiser_earning, seat_id/seat_name, attendee_details, checked_in, checked_in_at, is_bulk, bulk_code, booking_cancel, kids/seated/standing counts, distributor/association tag.
- `seatcharts`, `seats` (ticket_id, event_id, name, position, status, booking/hold), `schedules` (repetitive dates), `commissions` (per booking/organiser settlement), `taxes`, `promocodes` (+usage), `currencies`, `failed_bookings`, `reviews`, `tags` + `event_tags`, `glists` + `guests`, `attendees` (custom event attendees w/ label, seat, check-in), `distributions` (booking → recipient, seat, association, revoked), `event_codes` + code uses, `sessions`, `speakers`, `exhibitors` (+staff, videos), `custom_sections` + items, `announcements`, `event_notifications`, `notifications` (user in-app), `chats`, `chat_messages`, `message_reports`, `blocked_users`, `organizer_users` (sub-organizer ↔ event), `roles`/`permissions`, `settings` (Voyager), `pages`, `posts`, `menus`, `contacts`, `newsletter_subscribers`, `translations`, OpenAI prompt purchases/credits, `personal_access_tokens` (Sanctum), `cache`, `jobs`, `sessions`.

## 4. Inferred mobile-app API surface
Named `/api/v2` routes are in Ziggy; many app routes are **unnamed** and therefore invisible there — found by read-only probing (405/401 = exists). Auth is **Sanctum personal access tokens**: `POST /api/v2/login` validates `email, password, device_name` (canonical Sanctum pattern). No `/api/v1` exists.

Confirmed endpoints: `login`, `register`, `register-guest`, `logout`, `social-login`, `send-otp`, `forgot-password`, `email/resend`, `user`, `profile`, `profile/update`, `update-fcm-token`, `events` (same payload/filters as web: `category, city, state, country, search, price, start_date, end_date, page`), `countries`, `banners`, `venues/{slug}`, `organiser/{organisation_url}`, `organiser-mail`, `pages/{page}`, `book-tickets`, `apply-promocode`, `seat_status`, `my-bookings`, `bookings/cancel`, `get-booking-details`, `invoice-download/{booking}`, `myevents` (organiser), `bookings` + `bookings/{id}` + `bookings/api/organiser_bookings_edit` + `bookings/api/booking_customers` + `bookings/delete/{id}` (organiser), `scan-ticket-camera`, `scan-ticket-laser`, `verify-checkin`, `event-code/validate`, `event-code/my-events`, `event-code/{event_id}/attendees`, `messages/{id}/report`, `my-reports`, `notifications`, `chats` (+ `/api/chats/*` create/messages/read/typing, `/api/users/{id}/block|unblock`, `/api/users/blocked`, `/api/events/{id}/private-info`), `qPay/checkout|success|cancel|transaction`, `hello-world` (returns 500). Payment return URLs for in-app browsers: `/stripe/app-response`, `/paypal/app-callback`, `/flutterwave/app-callback`. Not found (404) and therefore probably served differently or absent: categories, event detail by slug, tickets/seats per event, distribution, sessions/speakers, reviews, translations (**UNVERIFIED** — enumerate in `routes/api.php`).

Apps (both by Pani Digital Services, LLC; both React Native per vendor lineage — **UNVERIFIED**):
- **Yayatoh** — iOS `id6755224885` ("Discover and book events", Entertainment, 41.8 MB, iOS 15.1+, English, 4+, free; v1.0.0 13-Nov-2025, v1.0.1 13-Jan-2026 "join event via code, chat/social", v1.0.3 12-Mar-2026 "Update UI and fix some bug"; privacy: coarse location, name/email, user & device IDs, product interaction, advertising data). Android `com.yayatoh.yayatohapp` (Events, 10+ downloads, released 12-Nov-2025, updated 12-Mar-2026, v1.0.3; data safety declares "No data shared / No data collected" — inconsistent with iOS). Features: discovery by category, featured/top-selling, filters date/price/location, booking, in-app QR tickets, profile + booking history, multilingual, Join Event via Code, chat/networking. Listing does not mention scanning; whether it includes the organiser/scanner mode is **UNVERIFIED**.
- **ABC Chicago 2026** (white-label tenant app) — iOS `id6760401721` (44.7 MB, iOS 15.1+; v1.0 16-Mar-2026, 1.1 25-Mar, 1.2 24-Apr "distribution management enhancements", 1.2.3 31-Aug-2026 "Update scan features"; collects contact info + user content: emails, texts, photos/videos). Android `com.abcchicago.app` (50+ downloads, updated 30-Aug-2026, "In-App Purchases" flag). Features: browse convention events/sessions, schedules, buy tickets and badges, real-time notifications, manage bookings, multi-venue. Support URL abc.yayatoh.com.

## 5. URL structure to preserve or 301
Public/indexable: `/`, `/events`, `/events/{slug}`, `/events/{slug}/tag_{tag}`, `/e/{short_url}`, `/events/{slug}/attendee`, `/venues`, `/venues/{slug}`, `/{organisation_url}` (root-level organizer profile — reserve a namespace such as `/o/{slug}` and 301), `/blogs`, `/blogs/{slug}`, `/pages/terms|privacy|booking-guide`, `/about-us`, `/features`, `/faq`, `/contact`, `/register`, `/login`, `/password/reset`, `/lang/{code}`, `/join-event`, `/storage/{path}` (media URLs embedded in emails, apps, OG tags, JSON-LD — must keep serving or rewrite).
Transactional links in past emails/PDFs: `/download/ticket/{id}/{order_number}`, `/download-multiple/tickets/{id}/{common_number}`, `/invoice/download/bookings/{id}`, `/magic-login/{token}`, `/email/verify/{id}`, `/forgot/password/reset/{token}`, `/mybookings/distribute/{booking}`.
Integration URLs configured with third parties: `/stripe/webhook`, `/stripe/success|fail|response`, `/stripe/app-response`, `/bookings/paypal/callback`, `/paypal/app-callback`, `/login/google/callback`, `/connet/stripe/response`. Bookmarked app URLs: `/dashboard`, `/mybookings`, `/profile`, `/scan-ticket-camera`, `/admin`. Tenant hosts `*.yayatoh.com`.

## 6. Payment / fee model observed
- Platform fee = **admin commission %** on (ticket price + organizer tax), set globally (Multi-vendor tab) and overridable per event (`e_admin_commission`; ABC's main event shows `100.00`, i.e. the platform keeps everything — probably an internal-tenant arrangement; **UNVERIFIED**). Admin taxes (fixed per ticket or %) can act as a buyer-facing "service fee". Organizer may absorb or pass on fees (FAQ). Public copy never states a rate; Terms say fees are disclosed at checkout and are non-refundable.
- Money flow: (a) Stripe Connect Standard "Stripe Direct" — automatic split at purchase; (b) otherwise funds land in the platform Stripe account and admin settles manually via Commissions → "Transferred"; FAQ promises payouts "within 5–7 business days" after the event to a connected bank account; chargebacks/refunds deducted. PayPal and offline (Zelle) also live. Refunds are organizer-defined, processed manually; cancelled-event refunds "5–10 business days". Currency USD default, per-event currency supported; organizer responsible for taxes.

## 7. Phase 0 discovery checklist (read the Laravel, DB and app source)
Codebase & vendor boundary
1. `composer.json/.lock`: exact `classiebit/eventmie-pro` version, Laravel/PHP versions, `laravel/sanctum`, `laravel/cashier`, `laravel/socialite`, `lab404/laravel-impersonate`, `tcg/voyager`, `barryvdh/laravel-dompdf` or `snappy` (PDF), `simplesoftwareio/simple-qrcode`, `twilio/sdk`, `kreait/firebase-php` or `laravel-notification-channels/fcm`, `openai-php`, `maatwebsite/excel`, `spatie/*`.
2. Diff custom code vs vendor: `app/Http/Controllers/**` overrides, `resources/views/vendor/eventmie-pro/**`, `resources/js/**` custom Vue apps (`public_attendee`, `PublicSeatSearch`, distribution, attendees, sessions/speakers/exhibitors), `public/css/eventmie-custom.css`, `app/Models/**`.
3. `routes/web.php`, `routes/api.php`, `routes/eventmie.php`, vendor route files; list **unnamed** API routes; route middleware (`auth:sanctum`, `throttle`), API versioning, CORS config.
4. `config/eventmie.php`, `config/voyager.php`, `.env` keys (mail driver, queue driver, cache, filesystem, Stripe/PayPal/Twilio/FCM/OpenAI/Google keys), `config/ziggy.php`.
Database
5. Full schema dump per instance (yayatoh.com, abc.yayatoh.com, staging): tables listed in §3, row counts, foreign keys, soft deletes; Voyager `data_types/data_rows/settings/menus/translations`.
6. `bookings` columns and semantics (`order_number`, `common_number`, `is_paid`, `booking_cancel`, `checked_in`, `is_bulk/bulk_code`, seat, attendee JSON, kids/seated/standing), `commissions` settlement rows, `failed_bookings`.
7. Seat model: `seatcharts`/`seats` columns, coordinate/percent format, image path, hold/expiry mechanism (DB flag vs cache vs cron), `seat_status` polling, per-date charts for repetitive events.
8. Custom tables: attendees, distributions (+ association/tag), event_codes + uses, sessions, speakers, exhibitors (+staff/videos), custom_sections/items, announcements, event_notifications, chats/messages/reports/blocks, glists/guests, openai purchases.
9. `events.private_info` and `tickets.access_dates` JSON schemas; `users.settings` JSON.
Tickets, QR, PDFs, emails
10. QR payload format (ticket id + order number? signed? URL?), QR library, PDF templates (`tickets/pdf.blade.php`, `invoice/invoice.blade.php`), all-in-one PDF logic, storage location of generated PDFs.
11. All Mailables/Notifications and templates in `resources/views/email_templates/`, SMS templates, WhatsApp implementation (Twilio WhatsApp sender vs wa.me link), push implementation (FCM legacy vs HTTP v1, APNs), notification queueing.
12. Queue jobs, scheduled commands (`app/Console/Kernel.php` / `routes/console.php`): reminders, seat-hold expiry, failed-booking sweeps, newsletter; cron on server.
Payments
13. Stripe integration details: Checkout vs PaymentIntents, Connect account type, `application_fee_amount`/transfer logic, webhook events handled, 3DS route, refund code paths, PayPal SDK version, `mesdoh` and `qPay` implementations, `/test-payment`.
14. Commission/tax computation code and rounding; per-event currency conversion.
Check-in
15. Scanner controllers: validation rules (event window, paid, disabled, access_dates, ticket-type access), duplicate detection and logging, group check-in, attendee-level check-in table, undo; any offline queue in the app (SQLite/AsyncStorage) and sync endpoint.
Auth & tenancy
16. Sanctum token lifetimes, `device_name` conventions, social login (Google/Apple) flows, OTP storage/expiry, magic-link generation and where links are sent, guest-account rules.
17. Tenancy: how abc.yayatoh.com is deployed (separate DB? separate codebase revision?), shared users or not, nginx vhosts, storage disks, DNS, how many tenants exist, staging environment purpose.
Mobile apps
18. App repos: RN version, `src/config/services.ts` API URL(s) per build (prod vs staging), auth/token storage, push setup (Firebase project, APNs keys), in-app payment flow (WebView return URLs), scanner screens, distribution screens, translations source, bundle ids/certs/keystores, App Store Connect + Play Console ownership, Apple "In-App Purchases" compliance for ticket sales.
Content & SEO
19. Export Voyager pages/posts/menus/settings/translations per tenant; media inventory under `storage/`; current Google Search Console index (to build the 301 map); analytics IDs.
Ops
20. Server (nginx), PHP-FPM, DB engine/version, backups, cron, queue worker, logs (`/api/v2/hello-world` and `/lang/{code}` return 500), SSL/wildcard certs, error monitoring.


## Key recommendations

- Treat the rebuild as a migration off Eventmie Pro FullyLoaded (Laravel 11 / Voyager / Vue 2 / Sanctum / Cashier), not off a bespoke app: start Phase 0 by diffing custom code against the vendor package to find the true custom surface (distribution, attendees, attendee portal, codes/private info, sessions/speakers/exhibitors, chat, OTP/magic login, kids counts, AI credits).
- Preserve the mobile API contract first: freeze and document every /api/v2 route from routes/api.php (many are unnamed and invisible to Ziggy), keep Sanctum bearer-token semantics (login requires email, password, device_name), and run a compatibility facade for the existing Yayatoh and ABC Chicago apps until new builds ship.
- Build the 301/URL map now from the observed structure (/events/{slug}, /e/{short}, /venues/{slug}, /blogs/{slug}, /pages/{slug}, root-level /{organisation_url}, /storage/{path} media, ticket/invoice download and magic-link URLs embedded in past emails) and reserve a namespaced organizer-profile path to end the root catch-all.
- Model tenancy as first-class (organization_id on every domain table, custom domains/subdomains, per-tenant branding/settings/apps) because today each white-label tenant is a separate Laravel install with its own database and its own store-published mobile app; plan a per-instance data import (yayatoh.com, abc.yayatoh.com, staging) with de-duplication of users.
- Redesign seating as a structured floor-plan model (venue/room, section, table, seat, object types, coordinates, capacity) with an importer for the current per-ticket-type image-plus-clicked-seat charts, keeping seat holds, per-date charts, seat-on-ticket, attendee seat assignment, and the public Attendee Portal seat finder (name/email search + OTP + self-select).
- Keep ticket distribution and its accountability features (recipient assignment, seat assignment, WhatsApp/email delivery, organizer distribute-for-buyer/revoke, distributor/association tag, bulk complimentary codes) as a core Orders/Tickets sub-module since it is a differentiator already in production use.
- Make check-in genuinely offline-capable (device-side ticket manifest, signed QR payloads, queued check-ins with conflict resolution) since the site already advertises 100% offline reliability but the vendor base has no offline mode; verify what the ABC app 1.2.3 'scan features' actually do before promising parity.
- Replace per-event JSON blobs (private_info, access_dates, is_publishable, social_links, video_link, venue images) with relational or typed-JSON schema on the new side, and normalise city/state/country data that is currently free text.
- Consolidate communications into one notification service (email, Twilio SMS, WhatsApp via Twilio, FCM/APNs push, in-app) with templates per tenant, since today email templates are Blade files, SMS is global Twilio, WhatsApp is a distribution-only path, and push tokens live on the users table.
- Fix SEO gaps during migration: add robots.txt, sitemap.xml, canonical and hreflang, absolute og:image URLs, correct JSON-LD addressCountry (currently emits the numeric country id), and keep JSON-LD Event schema on event pages.
- Formalise the fee model in data (platform commission %, per-event override, admin service-fee taxes, organizer taxes, absorb-vs-pass-on flag, Stripe Connect split vs manual settlement) and publish the rate on a pricing page; remove the live /test-payment and dormant gateway routes that are not used.
- Audit and align the app-store privacy declarations (Google Play says no data collected while the iOS listing declares location, identifiers and advertising data) and move the iOS privacy-policy URL off staging.yayatoh.com.


## Data model implications

- Organization/tenant entity above users, events, venues, tags, categories, settings, pages, posts, menus, banners, branding, domains and API tokens; today every table is implicitly single-tenant per install.
- User has role_id (admin/organiser/customer) plus organizer_id (parent) for sub-organizers with Manager/POS/Scanner roles scoped per event via an organizer_users pivot; needs to become a memberships table (user, organization, role, event scope).
- Event carries many flags (featured, is_private, coming_soon, e_soldout, show_reviews, scan_on_event_day_only, enable_public_seating, online_location, repetitive, merge_schedule, publish, is_publishable JSON) plus private_info JSON (wifi, shuttle, parking, contact, notes, program, visuals, custom_sections) that should become typed sub-entities.
- Ticket type fields to preserve: price, quantity, order, customer_limit, sale window (sale_start_date, sale_end_date, sale_price), is_donation, status, t_soldout, per-ticket taxes, and custom access_dates [{date,name}] for multi-day passes.
- Booking is one row per ticket grouped by order_number and common_number, with is_paid, payment_type, transaction_id, promo/reward, tax_data, admin_commission, organiser_earning, booking_cancel state, checked_in/checked_in_at, is_bulk/bulk_code, seat, attendee details and seated/standing/kids counts; new model should split Order, OrderItem, Ticket instance, Payment, Refund.
- Seat chart is image-based per ticket type with seat rows (name, position, enabled, held/booked) and per-date variants for repetitive events; plus event-level seatingchart_image.
- Attendee is a first-class record separate from the buyer (name, email, phone, label/tag, ticket, seat, check-in state, source: purchase/distribution/import/bulk), which is the seed of the cross-event CRM the vision wants.
- Distribution entity: booking/ticket -> recipient (name, email, phone), seat, association/distributor tag, sent-via channel, status, revoked flag, magic-login token.
- Event access code entity (code, active, expiry, max uses, usage rows) unlocking private info, attendee directory and chat; joined attendees appear under /my-events.
- Conference content entities already exist in lightweight form: sessions (date, time range, title, description, thumbnail, badge text), speakers (type/group, bio, social), exhibitors (description, staff, videos, website, contact, sponsor badge), custom sections with items, announcements with types and push side-effects.
- Communication entities: event_notifications (type, title, body, channel, history), user notifications, chats/chat_messages/message_reports/blocked_users, guest lists (glists/guests), newsletter subscribers, per-organizer Mailchimp credentials, users.fcm_token/apn_token.
- Finance entities: taxes (admin fixed/percent and organizer), promocodes (organizer-managed, per ticket, usage), currencies (per-event currency_id), commissions/settlements (transferred flag), failed_bookings, invoices with seller info/tax info/signature on the user, Stripe customer/connect ids on users.
- Venue entity is organizer-owned (organizer_id) with venue_type, slug, geo, images JSON and request-quote leads; many-to-many to events.
- Content entities from Voyager (pages, posts/blogs used as tenant CMS pages, menus, banners with app_event_slug, settings, translations) must be carried into a per-tenant CMS.
- Auth artefacts: Sanctum personal_access_tokens keyed by device_name, magic_login_token/expires_at, OTP codes, apple_id/google social identities, email_verified_at, guest-created accounts.


## Risks

- Hidden API surface: many mobile endpoints are unnamed routes not visible in the Ziggy manifest; missing one breaks a shipped app (two apps in stores, four store listings).
- Two live white-label instances (yayatoh.com, abc.yayatoh.com) with separate databases and overlapping IDs make user/attendee de-duplication and ID remapping error-prone; ABC's convention is in progress (Sept 2026) with active scanning.
- Offline scanning is marketed but not evidenced in the vendor base; promising parity without verifying the app source could regress door operations.
- Data quality: free-text city/state, category slugs with spaces and ampersands, placeholder private-info values, JSON blobs in columns, relative og:image paths, JSON-LD country id bug; all need cleaning during import.
- Payment continuity: Stripe Connect Standard accounts, Cashier stripe_id customers, PayPal callbacks, webhook URLs and pending manual settlements must be preserved exactly; live /test-payment and dormant gateway routes exist in production.
- Email and PDF links in the wild (ticket downloads, invoices, magic logins, distribution pages, verification) must keep resolving or be redirected with token compatibility.
- Vendor lock-in and licensing: Eventmie Pro is a commercial script; custom controllers/views overlay vendor code, so behaviour may depend on vendor internals that are undocumented (seat hold timer 8 vs 5 minutes, QR payload).
- Compliance: app-store privacy declarations are inconsistent across platforms; iOS privacy URL points to staging; Play flags In-App Purchases on the ABC app while tickets are sold through web flows; GDPR/CCPA rights promised in the privacy policy need real tooling.
- Operational fragility observed: /api/v2/hello-world and /lang/{code} return HTTP 500, no robots.txt or sitemap.xml, staging exposed by hostname.
- Scope creep: the current product already contains lightweight sessions/speakers/exhibitors/chat/codes; rebuilding them as full RainFocus-style modules while preserving today's simpler behaviour needs explicit feature-parity acceptance criteria per module.


## Open questions

- Which Eventmie Pro FullyLoaded version and license is installed, and is there a vendor support/customisation contract that constrains reuse of code or assets?
- Are yayatoh.com, abc.yayatoh.com and staging separate databases/codebases, and how many other tenant instances or custom domains exist or are planned?
- Do the Yayatoh and ABC Chicago apps share one React Native codebase, and does the Yayatoh app include the organiser/scanner mode or only the attendee experience?
- What exactly does the ABC app's offline/scan feature do today (local cache, queued check-ins, sync endpoint)?
- What is the actual platform fee structure (commission %, per-ticket service fee via admin tax, who absorbs it) and which organizers are on Stripe Connect versus manual settlement?
- What are the mesdoh and qPay payment integrations, are they live, and which markets/currencies do they serve?
- How is WhatsApp delivery implemented (Twilio WhatsApp sender with approved templates, or wa.me deep links) and is there a Meta Business account?
- What do the purchasable AI prompt credits cost and is that monetisation to be kept?
- Which organizations and events must be migrated with full history (bookings, check-ins, distributions, chat) versus archived, and is there a cut-over window between events?
- Who owns the Apple Developer / Google Play accounts, Firebase project, Twilio, Stripe and OpenAI accounts, and which are per-tenant versus platform-level?
- Is the root-level organizer profile URL (/{organisation_url}) relied on in marketing so that it must be preserved exactly rather than redirected?
- What is the intended status of the Exhibitor self-service portal and Sponsor profiles advertised on /features (only organizer-entered content is visible today)?


## Sources

- https://yayatoh.com/ (home, embedded Ziggy route manifest, meta tags)
- https://yayatoh.com/events and https://yayatoh.com/events/api/get_events?page=1 (public JSON, full event/user/ticket/venue columns)
- https://yayatoh.com/events/api/categories and /events/api/cities
- https://yayatoh.com/events/eec-gala
- https://yayatoh.com/venues, https://yayatoh.com/venues/martin-s-crosswinds, https://yayatoh.com/venues/tinley-convention-center
- https://yayatoh.com/pages/about, https://yayatoh.com/about-us
- https://yayatoh.com/pages/terms
- https://yayatoh.com/pages/privacy
- https://yayatoh.com/pages/booking-guide
- https://yayatoh.com/faq
- https://yayatoh.com/features
- https://yayatoh.com/contact
- https://yayatoh.com/register and https://yayatoh.com/login
- https://yayatoh.com/blogs and https://yayatoh.com/blogs?sort=id&page=2
- https://yayatoh.com/assets/js/eventmie_lang (UI label bundle, 1,461 keys)
- https://yayatoh.com/build/assets/index-*.js and EventListing-*.js (listing filter parameters)
- https://yayatoh.com/api/v2/events, /api/v2/login (validation body), /api/v2/countries, /api/v2/banners, /api/v2/venues/martin-s-crosswinds, /api/v2/pages/terms, plus read-only GET probes of /api/v2/* paths
- https://abc.yayatoh.com/, https://abc.yayatoh.com/about-us, https://abc.yayatoh.com/events/chicago-2026, https://abc.yayatoh.com/events/chicago-2026/attendee, https://abc.yayatoh.com/events/api/get_events?page=1, https://abc.yayatoh.com/iba
- https://apps.apple.com/us/app/yayatoh/id6755224885
- https://play.google.com/store/apps/details?id=com.yayatoh.yayatohapp
- https://apps.apple.com/us/app/abc-chicago-2026/id6760401721
- https://play.google.com/store/apps/details?id=com.abcchicago.app
- https://eventmie-pro-docs.classiebit.com/ (index), /docs/3.0/changelog/changes, /docs/3.0/fullyloaded/introduction
- https://eventmie-pro-docs.classiebit.com/docs/3.0/fullyloaded/reserved-seating
- https://eventmie-pro-docs.classiebit.com/docs/3.0/fullyloaded/hands-free-advanced-ticket-scanner and /docs/3.0/bookings/ticket-scanner
- https://eventmie-pro-docs.classiebit.com/docs/3.0/fullyloaded/pos-scanner-manager
- https://eventmie-pro-docs.classiebit.com/docs/3.0/fullyloaded/stripe-connect and /docs/3.0/admin/commissions and /docs/3.0/admin/taxes
- https://eventmie-pro-docs.classiebit.com/docs/3.0/bookings/booking-tickets, /bookings/cancellation-refund, /bookings/email-notifications, /bookings/manage-bookings
- https://eventmie-pro-docs.classiebit.com/docs/3.0/fullyloaded/event-guestlist, /attendee-custom-fields, /complimentary-bookings, /create-attendee, /guest-checkout, /ticket-invoice, /email-customisation, /private-event, /organizer-profile, /twilio-sms, /organiser-sales-report
- https://eventmie-pro-docs.classiebit.com/docs/3.0/events/repetitive-events and /events/manage-venues
- https://eventmie-pro-docs.classiebit.com/docs/3.0/admin/settings and /admin/organiser-approval
- https://eventmie-pro-docs.classiebit.com/docs/3.0/artificial-intelligence/ai-event-creation
- https://eventmie-pro-docs.classiebit.com/docs/3.0/apps/introduction, /apps/installation, /apps/ticket-scanning, /apps/ticket-booking, /apps/organiser-dashboard, /apps/multi-lingual
- https://github.com/classiebit/eventmie (open-source base: migrations list, routes/eventmie.php, create_bookings_table, alter_users_table)
- https://codecanyon.net/item/eventmie-pro/25555040 and https://classiebit.com/eventmie-pro (vendor feature summaries via search)
- /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (vision document)
