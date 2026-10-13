# Legacy code audit — Yayatoh (Eventmie Pro 3.0.0 on Laravel 11)

- **Audited:** a snapshot of `gitlab.com/eventmie-pro/abc-web` (branch `main`), read-only, 2026-09-26. It is mirrored privately as `Pani-Digital-Services-LLC/yayatoh-legacy`, with secrets redacted.
- **Both hosts run this code:** yayatoh.com and abc.yayatoh.com share one codebase, with separate databases and settings.
- **Limits:** `vendor/` is not in the repo, so framework and library behaviour is inferred and marked as such. Confirm routes with `php artisan route:list --json` on staging (Phase 0, audit step 4).
- **Security findings and fixes:** see `M0.0-security-hotfix.md`.

## 1. Shape of the codebase

**Stack**
- Laravel `^11.31`; `classiebit/eventmie-pro` 3.0.0 is **vendored in-repo at `./eventmie-pro`** as a path package, and **edited in place**. Examples: Vietnamese comments in `OBookingsController`; a custom migration `2026_01_23_000000_add_multiday_columns_to_tickets.php` inside the package.
- A diff against pristine 3.0.0 is still needed (audit step 3).
- The app overrides the package controllers through `config/eventmie.php:112` (namespace `App\Http\Controllers\Eventmie`).
- Frontend: Vue 2 bundles built by Vite (14 entries, listed in `entries.txt`). Voyager admin.

**Routing** (`bootstrap/app.php`, `RouteServiceProvider.php:42-54`)
- Load order: `routes/api/v2/index.php` (prefix `api/v2`), then `routes/api.php`, then `routes/web.php`.
- `web.php` is registered twice. When a method + URI is defined more than once, **the last registration wins**.
- `app/Http/Kernel.php` is **dead code** in Laravel 11. The `api` group therefore effectively carries only `SubstituteBindings`, with no throttling.
- The package routes in `eventmie-pro/routes/eventmie.php` load via `Eventmie::routes()` at `web.php:271`.

**The `view()` override** (`app/Helper/helpers.php:13-16`, loaded before Composer in `public/index.php:13`)
- Under `api/v2`, every web controller's `view()` returns `{"data": {...all view variables...}, "status": true}`.
- This is how the mobile API reuses web controllers. It is also the main source of data leaks.

**Roles:** 1 admin, 2 customer, 3 organiser, 4 pos, 5 scanner, 6 manager, 7 suborganizer.

**Scoping and delegation**
- `user_roles(user_id, role_id, event_id)` scopes pos/scanner users per event.
- `users.organizer_id` links a sub-organiser to its organiser.
- The `SubOrganizer` middleware remaps managers to act as their organiser (route groups only).

**Deployment**
- LiteSpeed with `lsphp83`. Staging runs on `staging.yayatoh.com`. MySQL 8 in the Sail docker-compose.
- **Scheduler:** `routes/console.php` runs `tasks:run-scheduled` every minute (releases seat holds and failed bookings) and `sitemap:generate` daily. It needs `* * * * * php artisan schedule:run`.
- **Queue:** `sync` by default, so mail is sent inline.

## 2. Mobile API (`/api/v2`) — contract inputs for the facade

**Routes the React Native app uses** (M = used by the app; full table in `routes/api/v2/index.php`):
- **Auth:**
  - `ANY login` (email, password, device_name; also accepts GET) **M**
  - `POST logout` **M**, `POST register` **M**
  - `POST social-login` **M** (broken security)
  - `POST register-guest` **M**, `POST send-otp` **M**, `POST forgot-password` **M**
  - `POST email/resend` (throttle 6/min)
  - `GET user` (full user row)
  - `POST update-fcm-token` **M**
- **Discovery:**
  - `GET landingPage`, `GET get-countries`, `GET banners`, `GET countries` **M**
  - `GET eventFilters`, `ANY events`, `GET events/show/{event}`, `ANY events/details`, `ANY events/booked-seats` **M**
  - `GET pages/{page}`, `GET organiser/{organisation_url}`, `POST organiser-mail`, `GET venues/{slug}`
- **Buying:**
  - `POST apply-promocode` **M**, `POST book-tickets` **M**
  - `GET my-events`, `ANY my-bookings`, `POST cancel-booking` **M**
  - `GET ticket-download/{id}/{order_number}`, `ANY invoice-download/{booking}`, `POST get-qrcode` **M**
  - `GET seats-selection` (returns a WebView URL for `seats.index`), `POST seat_status` (public write)
  - `GET generate-pass/{booking_id}` (Apple Wallet; unauthenticated)
- **Organiser:**
  - `GET bookings`, `GET bookings/{id}`, `GET bookings/delete/{id}`
  - `POST bookings/api/organiser_bookings_edit`, `POST bookings/api/booking_customers`
  - `GET myevents`, `POST event-dashboard`
- **Scanner** (`auth:sanctum` + `organiser`) **M:** `GET scan-ticket-camera`, `GET scan-ticket-laser`, `POST verify-checkin`, `POST get-booking-details`.
- **Distribution:**
  - `GET distribute/status/{booking}`
  - `POST assign`, `POST send-whatsapp`, `POST update-name`, `POST assign-seat`
  - `GET download-all/{booking}`, `GET seatchart-by-date`
- **Community M:**
  - `POST event-code/validate`, `GET event-code/my-events`, `GET event-code/{event_id}/attendees`
  - `GET chats`, `POST chats/create`, `GET|POST chats/{id}/messages`, `POST chats/{id}/messages/read`, `POST chats/{id}/typing`
  - `POST users/{id}/block`, `DELETE users/{id}/unblock`, `GET users/blocked`
  - `POST messages/{id}/report`, `GET my-reports`
  - `GET notifications`, `POST notifications/read-all`, `GET notifications/unread-count`
  - `POST broadcasting/auth` (Pusher)
- **Profile:** `GET profile`, `POST profile/update`, `POST profile/update-password`, `POST profile/delete`, `POST profile/become-organizer`.
- **Dead** (their controllers are missing): `hello-world`, `qPay/*`, `password/remind`.

**Web-defined `/api/*` URIs clash with `api/v2`.** `web.php:847-865` defines `/api/chats*`, `/api/events/{id}/private-info` and `/api/messages/{id}/report` with session auth. Chat URIs defined in both places probably resolve to the web versions, because web loads last. **Verify which version wins** before building the facade.

**Response shapes** (inconsistent; the facade must copy each route's shape from golden HARs):

| Route / helper | Shape |
|---|---|
| `view()` override | `{data:{…}, status:true}`; `details`, `banners` and `get-countries` add a second level of nesting |
| events list | `{events:{currency, data[], total, per_page:12, current_page, last_page, links, from, to, next_page_url, countries, cities, states}}` |
| login | `{success, data:user, image_url_prefix, token, verify_email}` |
| register (201) | `{status, message, data, image_url_prefix, token, verify_email}` |
| guest | `{status, guest, token}` |
| my-bookings | `{bookings:<paginator>, currency}` |
| notifications | `{status, notifications[…], pagination{…}}` |

**Errors**
- Laravel 422 `{message, errors}`, but **only when the client sends `Accept: application/json`**; otherwise a redirect.
- `error()` helper: `{errors:{error:[msg]}}` with status 422 or 400.
- `{status:false, message}`.
- Social login failures return **200** `{success:false}`.

**Dates, tokens and push**
- Timestamps are ISO-8601 UTC with microseconds. `start_date` is `Y-m-d`; `start_time` is `H:i:s`.
- Image URLs get an absolute `storage/` prefix only under `api/v2`.
- **Sanctum:** guard `web`, expiration **2,880 min (48 h)**, `token_prefix` from env or `''`. No refresh endpoint.
- **Push:** `kreait/firebase-php` over **FCM HTTP v1**. The service account lives at `storage/app/firebase/service-account.json`, which is not in the repo.
  - Only one `fcm_token` and one `apn_token` are stored per user.
  - `apn_token` is sent through FCM, which is wrong for raw APNs tokens.
- **Chat:** Pusher private channels `chat.{id}` and `App.Models.User.{id}`.
- **RN app:** `src/config/services.ts` sets `API_URL = BASE_URL + '/api/v2'`. There is no version header and no app-version check. Certificate pinning is not visible from the server code; confirm it in the app source.

## 3. Data model (key tables)

Tags:
- **[PKG]**: from the Eventmie package.
- **[BASE]**: from the webinstaller migrations dated 2019–2023.
- **[CUSTOM]**: 2024+ migrations.

**users**
- Mixed [PKG]/[BASE]: Cashier columns, `role_id`, `organizer_id`, `organisation`, `bank_*`, `taxpayer_number`, `seller_*`, `mailchimp_*`, `stripe_account_id`, `ip_address`, `settings` JSON.
- [CUSTOM]: `fcm_token`, `apn_token`, `organisation_url`, profile fields, `social_links` JSON, `apple_id`, `magic_login_token`, `magic_login_expires_at`.
- There is no per-user timezone column.

**events**
- Stores separate `start_date`/`end_date` DATE and `start_time`/`end_time` TIME columns, as **local wall-clock** values.
- Also: `repetitive`, `merge_schedule`, `is_publishable` (JSON of step flags), `e_admin_commission` (per-event override), `event_password`, `is_private`, `currency`, `short_url`, `scan_on_event_day_only`.
- [CUSTOM]: `coming_soon`, `private_info` (JSON), `poster`, `youtube_banner`, `enable_public_seating`.
- `private_info` shape: `{wifi:{network,password}, shuttle:{pickup,pickup_time,dropoff,dropoff_time}, parking:{location,code}, contact:{name,phone,email}, notes, custom_sections:[{title,content}], visuals:[{title,image}], program:[{title,content}]}`.

**tickets**
- `price`, `quantity`, `customer_limit`, `t_soldout`, `sale_start_date`/`sale_end_date`, `sale_price`, `is_donation`, `order`, `thumb`.
- `is_multi_day` and `access_dates` (JSON `[{date, name}]`; the older `["YYYY-MM-DD"]` form also exists).
- Taxes live in `taxes` + `tax_ticket`: rate type, `net_price` `including`/`excluding`, and an `admin_tax` flag.

**bookings**
- **Default: one row per person**, with `quantity=1` and its own `order_number`. A **"distribute later"** booking is one row with `quantity=N`, `is_distributable=1`, and N unassigned attendees.
- Keys: `common_order` (checkout group), `order_number` (`time()+rand`, **not unique**), `transaction_id`, `payment_type` (online, offline, import, transfer, code).
- Status fields: `is_paid`, `status`, `booking_cancel` (0 none, 1 requested, 2 approved, 3 refunded).
- Also: `is_bulk` (hidden by `BulkScope`), `promocode_*`.
- [CUSTOM]: `distributor_tag` (association), `is_distributable`, `distributed_by`, `distributed_from_booking_id`.
- `checked_in` is legacy and never written.

**attendees**
- `booking_id`, `ticket_id`, `event_id`, `seat_id`, `seat_name`, `name`, `phone`, `address`.
- **Email is stored in `address`**; there is no email column.
- [CUSTOM]: `user_id`, `event_code_id`, `joined_via_code`, `planned_seat_label` (table/group label), `event_date` (multi-day: one row per access date), `assignment_status`.

**Seating**
- `seatcharts`: one per ticket (per `event_date` for multi-day), plus `chart_image`, re-encoded to WebP at most 2,500 px wide.
- `seats`: `coordinates` stored as the string `"Xpx,Ypx"` in the image's natural pixels (some older rows use `{left,top}`), plus `name`, `width`, `height`, `font_size` and `capacity`. Capacity above 1 means a table.
- `seat_statuses`: live UI locks. Its "per date" unique index is actually on `seat_id` alone (migration bug).

**Seat holds**
- Held seats live in `failed_bookings.seats` (session snapshot) and `seat_statuses`.
- `tasks:run-scheduled` releases them after 10 minutes, so the effective TTL is 10–15 minutes.
- Stripe Checkout Sessions have **no `expires_at`**, so a late payment can double-book a seat.

**checkins**
- Source of truth for attendance: `booking_id`, `event_id`, `event_start_date` (the regional scan date), `check_in_time` (UTC time-of-day), `user_id` (the scanner), `kids_count`.
- **Per booking, per day.** There is **no unique index**.

**Money**
- `commissions`: `organiser_id`, `booking_id`, `event_id`, `admin_commission`, `customer_paid`, `organiser_earning`, `admin_tax`, `status`, `transferred`, `settled`, `month_year`.
- `transactions`: gateway records.
- `failed_bookings`: a session snapshot per checkout, also used as the seat-hold store and for recovery.

**Other domains**
- Promos: `promocodes`, `promocode_user`, `ticket_promocode`.
- Guest lists: `glists`, `guests` (organiser marketing email lists; **no import**), `newsletter_subscribers`, `otps`.
- [CUSTOM] event content: `event_codes` (code, `ticket_id`, `expires_at`, `max_uses`, `current_uses`), `event_sessions`, `event_speakers`, `event_exhibitors`, `event_announcements`, `event_custom_sections(_items)`.
- [CUSTOM] chat: `chats`, `messages`, `blocked_users`, `message_reports`.
- Notifications: `notifications` (uuid, `data` JSON, `n_type`, `event_id`).
- Voyager: `settings`, `posts`, `pages`, `menus`, `menu_items`, `banners`, `translations`, `data_types`/`rows`, `permissions`, `roles`.
- Cashier `subscriptions` exist but are unused.

**AI credits:** not implemented. `OpenAIController::getAvailablePromptBalance()` returns a hard-coded 10, and the purchase routes point to missing methods. There is nothing to migrate.

## 4. Tickets, QR codes and check-in

**QR codes**
- Payload: the **raw `order_number`**, or JSON `{"id":…,"order_number":"…"}`, depending on which generator ran.
  - `DownloadsController` generates the raw form.
  - `TicketPdfGenerator`, `DownloadsMultipleController` and `TicketScannerController::getQrcodeUrl` generate the JSON form.
  - All write to the same file name, so the last one wins.
- The scanner parses either form and uses **only `order_number`**. Nothing is signed.
- Generated with `simplesoftwareio/simple-qrcode`: 256 px PNG at `storage/qrcodes/{customer_id}/{booking_id}-{order_number}.png`.

**Tickets and passes**
- PDFs use dompdf; the ticket page is 396×153 pt landscape. Stored in the public `storage/ticketpdfs/...` and `invoices/...`.
- Apple Wallet passes use `thenextweb/passgenerator`.

**Scanner** (`TicketScannerController`)
- Lookup by `order_number`. With `scan_all=1`, only that booking is checked in. With `scan_all=0`, every booking sharing its `common_order` is checked in. The UI labels are inverted relative to these values.
- Validation:
  1. The event is allowed for the scanning user.
  2. `status=1`.
  3. `is_paid=1`.
  4. Today is not after `event_end_date`.
  5. `scan_on_event_day_only` blocks scans before the start date.
- **Not checked:** `booking_cancel`, `access_dates`, or `attendees.event_date`.
- **Duplicates:** `firstOrCreate` per booking per day. A repeat scan returns `flag: warning` with the original time and scanner.
- There is no scanner-side undo; the admin panel `undoCheckIn` deletes the latest check-in.
- **No offline support.** The web scanner refreshes every 30 s.

**Public seat finder** (`PublicEventController`, `/events/{slug}/attendee*`)
- Search, then either email OTP (6 digits, 10 min, **no attempt limit**) or direct login, then a 1-hour seat token, then self-select.
- Selection ignores table capacity and never sets `seat_name`.

## 5. Distribution

- **Source:** "distribute later" checkouts, or admin `createBulkTickets`.
- **Distributing:** the buyer enters recipient emails and phones.
  - Each recipient gets a user via `firstOrCreate` and a **new booking** (qty 1, price 0, `payment_type='transfer'`, a new `order_number` and therefore a new QR).
  - The recipient's attendee rows move to the new booking.
  - A **magic link** is emailed: 64-hex token, valid 72 h, single use.
- **WhatsApp:** Pani's own template gateway (`App\Service\WhatsAppService`, default `https://whatsapp.panitechnologies.com`, `WHATSAPP_*` env vars).
  - Sends invoice and ticket PDFs as document templates.
  - The PDFs are copied to public `storage/whatsapp/{random}.pdf`.
  - Twilio is used for SMS only.
- **Revoke:** admin only. Blocked once the ticket has been checked in. Deletes the child booking.
- **Association:** stored in `bookings.distributor_tag`.
- **CSV import** (`EventDetailsController::importAttendees`): headerless columns `name, email, phone, seat_labels, distributor_tag`. Creates one `import` booking per row, plus attendees per access date. Seats are resolved by label.

## 6. Payments and fees

**Stripe checkout** (codes 2 and 5)
- `StripeDirectController::redirectStripeCheckout` creates **Checkout Sessions as direct charges on the organiser's Standard connected account**, with `application_fee_amount` = Σ admin commission + Σ admin tax.
- If the organiser has no connected account: the charge goes to the platform account with no fee, and settlement is manual through `commissions.transferred`.
- **Mobile checkout** returns `checkout->url` for a WebView, then `/stripe/app-response`.

**Stripe Connect**
- `StripeConnectController::createStripeAccount` calls `Account::create(type: standard, country: 'US', business_type: individual)` plus an AccountLink. There is no OAuth.
- Disconnecting **deletes** the account and swallows errors.

**Webhook**
- `/stripe/webhook`, handled by the Cashier subclass: **signature check disabled** (see the hotfix doc).
- Handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Payloads are logged to `webhook_test`.

**Legacy Stripe bugs**
- `appStripeCallback` and `VerifyStripe` retrieve without the `stripe_account` header, so they fail for connected organisers.
- Codes 2 and 5 disagree on marking `transferred`.

**Refunds:** there is no gateway refund code. `booking_cancel` 2/3 plus commission `status=0` only; the actual refund is done manually in the dashboard.

**Other gateways**
- PayPal: Omnipay `PayPal_Rest` (v1).
- "Offline": a free-text field per event; there is no Zelle-specific code.
- Mesdoh (code 12): hosted checkout at `api.jetcamer.com`, **trusts the callback query**.
- Flutterwave: **trusts the callback and webhook**.
- Paystack, Razorpay, Paytm, MercadoPago, BitPay and Authorize.Net are coded but only live if their settings are filled in.

**Fees and commission**
- **Commission:** `multi-vendor.admin_commission` %, overridden per event by `e_admin_commission`. It is computed on the ticket amount plus *excluding* organiser taxes.
  - `organiser_earning` = amount − commission.
  - `admin_tax` is stored separately.
- **Admin taxes:** act as the platform service fee. `excluding` means the buyer pays it on top; `including` means it is absorbed.
- **Promo codes:** reduce `net_price` *after* commission, so the organiser absorbs the discount while the Stripe application fee stays at full amount.
- **Rounding:** `number_format(…,2)` per line; Stripe amounts use `(int) round(x*100)`.

## 7. Messaging

- **Mail:** synchronous SMTP from Voyager `mail.*` settings.
  - Mailables: `BookingMail`, `TicketDistributionMail`, `RegisterMail`, `EditBookingMail`, `EventMail`, `BecomeOrganizerMail`, `ContactMail`, `OrganizerContactMail`, `ReviewMail`, `OtpMail`.
  - Most are sent via `RegistrationEmailJob` with a 10 s delay, which is ignored because the queue is `sync`.
- **Twilio SMS:** one SMS per booking containing public PDF URLs.
- **Mailchimp:** per-organiser API key, stored in plaintext. The buyer is subscribed and tagged on each booking.
- **Announcements:** push delivery is a TODO.
- **Event notifications:** speaker change, room change, schedule update, announcement and reminder, sent via FCM.

## 8. Time

- `config/app.php` sets `timezone: UTC`, but it is **overwritten at runtime** from the `regional.timezone_default` setting (`AppServiceProvider.php:67-71`). `date_default_timezone_set` is never called, so `now()` stays UTC.
- Code that needs a local "today" uses `now(setting('regional.timezone_default'))`. The scanner does this; admin check-in and the revoke guard use UTC.
- Per-user timezone lives only in the session (`/set/local_timezone`, defined twice).

## 9. Known issues from the team's own notes

**TaskLIST.md** (Vietnamese):
- A bulk-ticket ZIP download on the distribution page.
- Attendee details for bulk tickets bought for later distribution.
- Testing table purchase → payment → distribution.

**`booking_and_seat.md`** documents the booking → attendee → seat model. Its note that event codes create no booking is outdated: codes now create a `code` booking.

**Code TODOs:**
- announcement push (`EventDetailsController:1650`)
- moderation warnings (`MessageReportController:330`)
- report notifications (`Api/ReportController:110`)

**Dead code:**
- `StripeWebhookController` (contains `dd()`)
- unused Cashier `charge`/3DS methods
- `StripeConnectController::transfer`
- `GenerateOtpJob`, `SendOtp`

**Hard-coded values:**
- Staging share link in `events/show.blade.php:806-822`.
- `info@yayatoh.com` in `about.blade.php:211`.
