# Threat model v1 (M1.14d)

STRIDE per surface, as built at M1.14. "Control" names what exists and where; **Gap** marks what
is planned or needs an owner account. Review at every phase exit and when a new surface ships.

**Assets:** attendee and buyer personal data (org-controlled), organizer bank/payout details
(Stripe-held), money movement (ledger, transfers), ticket validity (signing keys), tenant
isolation, staff access, the audit trail.

**Trust boundaries:** browser ↔ edge (Vercel) ↔ app (Next.js / Hono) ↔ Postgres (RLS roles) ↔
providers (Stripe, email, KMS); door devices ↔ `/v1` scanner API; staff console (`apps/admin`,
`platform_reader`).

## 1. Public pages and checkout (`/events/*`, `/checkout/*`, `/orders/*`, `/my-tickets/*`)
| | Threat | Control | Gap |
|---|---|---|---|
| S | Buyer impersonation to see someone's order | Orders and holder pages need an unguessable token (hash stored; ADR 0014) | — |
| T | Tampered prices, quantities or seats | Prices from the database, never the form; server-side quote; holds with expiry (orders, ticketing) | — |
| R | Buyer disputes a purchase | Order + provider event records; ledger; audit | — |
| I | Token URLs leak via Referer or crawlers | `Referrer-Policy: no-referrer` on token pages; `robots.txt` disallows them; tokens never logged by the CSP report endpoint (query stripped) | — |
| I | XSS steals session or data | CSP (public: `'self'` + nonce, no `'unsafe-inline'`/`'unsafe-eval'`); React escaping; allowlist serializers | Static-cached public pages need build-time hashes (M3.x) |
| D | Inventory hoarding / bot checkouts | Rate limit `checkoutStart` per device and IP ceiling; hold expiry sweeper (30 s) | BotID / Turnstile and a waiting room for big on-sales (owner accounts) |
| E | — | Public commands use `public:` permissions and validate everything server-side | — |

## 2. Sign-in and sessions (`/sign-in`, `/api/auth/*`)
| | Threat | Control | Gap |
|---|---|---|---|
| S | Credential stuffing, OTP brute force | Rate limits per device, per email (hashed) and per IP ceiling (M1.14a); Argon2id password hashing | Breached-password check (roadmap §10); Turnstile after N failures (owner key); 2FA / step-up (M1.2c, in progress) |
| T | Session fixation / cookie theft | `__Host-` session cookie, Secure, HttpOnly, SameSite=Lax; COOP same-origin | — |
| I | Password in URL (form GET fallback before hydration) | Sign-in form is `method="post"` (found by ZAP, fixed in M1.14) | — |
| D | Lockout of a victim by an attacker spraying their email | Identity bucket is looser (20/15 min) than the device bucket; per-device limits let the real user's device through | Account-level alerting |
| E | CSRF on Server Actions | Next Origin check; `serverActions.allowedOrigins` empty by default (no `*`); SameSite cookies | — |

## 3. Organizer console (`/o/*`)
| | Threat | Control | Gap |
|---|---|---|---|
| S | Using another member's account | Session auth; step-up for sensitive commands | Step-up UI (M1.2c) |
| T | Changing another org's data | Tenant from the route + membership, never headers; `withTenant` + FORCE RLS; isolation suite with fixtures for every table | — |
| R | "I didn't do that" | Append-only audit log with a per-org **hash chain**; Settings → Activity shows "Verified"; exports audited | WORM copy of the chain head (owner: object storage with Object Lock) |
| I | Viewer reads finance/PII | Role permissions in commands (`audit:read`, `privacy:manage`, `finance:read`, `attendees:export`); download routes re-check | — |
| I | Exported files linger | Files expire in 7 days and are deleted by retention; DSAR erasure deletes files mentioning the person | R2 with lifecycle rules (owner) |
| D | Huge exports | Bulk framework caps (50 000 rows, chunks) | — |
| E | Viewer calls a command directly | Every write is `executeCommand` with authorize step; e2e checks refused direct URLs | — |

## 4. Scanner API (`/v1/*`, `/api/v1/*`) and the Scan PWA
| | Threat | Control | Gap |
|---|---|---|---|
| S | Fake door device | Device bearer tokens (hash stored), revocable, org from token | — |
| T | Forged or copied QR codes | Signed yy1 payloads (per-org keys in KMS envelopes); duplicate detection; fraud signals | — |
| R | Disputed admission | Append-only scan log with device and clock offset (kept 12 months) | — |
| I | Manifest scraping | Device-scoped, event-scoped manifests | — |
| D | Venue Wi-Fi down | Offline mode with signed manifests (M1.9) | — |
| E | Device acts outside its event | Device context carries the org; commands check the event | — |

## 5. Webhooks (`/api/webhooks/*`)
| | Threat | Control | Gap |
|---|---|---|---|
| S | Forged payment success | Signature verified on the raw body; amount/currency/payment id checked against the order | — |
| T | Replay | Dedup by provider event id | — |
| D | Flood of forged calls | Only failed verifications count against a per-IP limit (30/10 min) → 429 | WAF rule at the edge (owner) |

## 6. Staff console (`apps/admin`) and the worker
| | Threat | Control | Gap |
|---|---|---|---|
| S | Non-staff access | Owner-approved staff list; staff roles | Passkeys for staff (roadmap) |
| I | Cross-tenant reads | `platform_reader` only in admin/worker (check-modules gate), every use in `platform.access_log` | Admin app CSP (M1.14 covered `apps/web`; admin next) |
| T | Tampering with logs | Access log append-only via SECURITY DEFINER; purge only after archiving and never inside 12 months | — |
| E | Worker runs with too much power | Worker writes as app_user per org (RLS), reads cross-tenant only through audited platform_reader | — |

## 7. Server-side fetches of user-supplied URLs (custom domains, webhooks out, images)
| | Threat | Control | Gap |
|---|---|---|---|
| I/E | SSRF to cloud metadata, internal services | `@yayatoh/platform/ssrf`: https only, public unicast addresses only (IPv4 and IPv6 incl. mapped/NAT64/6to4/Teredo), every DNS answer checked, connection pinned to the checked IP (rebinding), redirects re-checked, size and time limits | Isolated image worker (roadmap) |

## 8. Data and privacy
| | Threat | Control | Gap |
|---|---|---|---|
| I | Personal data kept too long | Retention job: abandoned checkouts 30 d, attendee PII 24 months after the event, scan log 12 months, holder links, expired files, bulk params | Owner confirmation of defaults |
| I | Unhandled DSARs | Privacy requests console: find, export (JSON), erase with legal holds; masked accountability record | DPA click-through final text (counsel) |
| T | Backups tampered or lost | Encrypted off-account dumps; restore drill verifies audit chains and ledger balance | Backup account + Object Lock + offline key (owner) |

## Residual risks accepted for now
- Next's fallback error shell for unknown file paths carries an inline `<style>` that the CSP blocks
  (cosmetic; no script is ever allowed).
- `NEXT_LOCALE` cookie is not HttpOnly (locale preference, not sensitive).
- Rate limiting fails open if its store is down (logged and alerted): availability over strictness
  for sign-in and checkout.
