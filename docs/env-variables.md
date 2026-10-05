# Environment variables: what the owner fills in, and where

Every name below is in [`.env.example`](../.env.example) (79 names). **Values never go in the repo or in a chat.** This page says, for each name, who sets it, where it lives, and whether it is a test value or a production one.

## Where values live

| Place | What goes there | Who reads it |
|---|---|---|
| **Cloud environment `yayatoh`** (claude.ai/code → Environments) | Almost nothing. The builder sessions run on local Docker and the fake providers; their tests depend on that. Only the names in column ① below, test values only. | Every builder and merge session. |
| **Second cloud environment `yayatoh-integrations`** (recommended, create it the same way, same setup script and network list) | The **test/sandbox** credentials in column ② (Stripe test mode, SES sandbox, Twilio test credentials, Turnstile test keys…). Used later, in the stabilise step, by sessions that check the real test-mode connections. | Only sessions started in it. |
| **Doppler** (configs `dev`, `preview`, `staging`, `production`) | Everything a deployed app needs, per environment. Production values only in the `production` config. | Vercel / the worker host at deploy time. |

Why not put everything in `yayatoh`? Those values are inherited by every test run. A provider switch (e.g. `EMAIL_PROVIDER=ses`) would make tests send real email; `PAYMENTS_PROVIDER=stripe` is forbidden outside a reviewed runbook; a `DATABASE_URL` would point the test suite away from its throwaway database; `SOCIAL_SIGN_IN_PROVIDER=real` or `HUMAN_CHECK_PROVIDER=turnstile` breaks the browser tests that use the fake consent page and test checkbox.

**Legend:** ① cloud `yayatoh` · ② cloud `yayatoh-integrations` (test values) · S = Doppler staging/preview · P = Doppler production · — = never set there · gen = you generate it (`openssl rand -hex 32`).

## 1. Set by tooling: leave unset in both cloud environments

The local defaults (docs/local-development.md, `docker compose`) fill these in. In Doppler, staging and production get real values from the hosting set-up.

| Variable | ① | ② | S | P | Value in S/P |
|---|---|---|---|---|---|
| `DATABASE_URL` | — | — | ✓ | ✓ | Neon runtime role (NOBYPASSRLS), pooled |
| `MIGRATOR_DATABASE_URL` | — | — | ✓ | ✓ | Neon schema-owner role, direct (not pooled) |
| `ADMIN_DATABASE_URL` | — | — | — | — | Local/CI only (creates roles) |
| `PLATFORM_READER_DATABASE_URL` | — | — | ✓ | ✓ | BYPASSRLS role; admin and worker only |
| `JOBS_DATABASE_URL` | — | — | ✓ | ✓ | pg-boss schema connection |
| `REDIS_URL` | — | — | ✓ | ✓ | Upstash Redis URL |
| `SMTP_URL` | — | — | — | — | Local Mailpit only |
| `DEV_MAILBOX_DIR` | — | — | — | — | Local only |
| `GOTENBERG_URL` | — | — | ✓ | ✓ | Private URL of the PDF renderer |
| `LOCAL_KMS_KEY` | — | — | ✓ | — | gen (dev/preview/staging only; production uses AWS KMS) |
| `YAYATOH_DEV_AUTH`, `DEV_PERSONA_PASSWORD` | — | — | preview only | — | Dev login personas; never in production |
| `FAKE_PAYMENTS_SECRET`, `FAKE_EMAIL_WEBHOOK_SECRET` | — | — | ✓ | — | gen; never in production |
| `CUTOVER_STAGING_HOSTS` | — | — | — | — | Set only on the machine that runs a staging rehearsal |

## 2. Origins and hosts (per deployed environment)

| Variable | S example | P value |
|---|---|---|
| `BETTER_AUTH_URL` | `https://staging.yayatoh.com` | `https://yayatoh.com` (app host) |
| `NEXT_PUBLIC_APP_ORIGIN` | staging app origin | production app origin |
| `API_ORIGIN`, `API_PUBLIC_URL` | staging API origin | `https://api.yayatoh.com` |
| `ADMIN_AUTH_URL` | staging admin origin | `https://admin.yayatoh.com` |
| `PASSKEY_RP_ID` | staging domain | `yayatoh.com` |
| `TENANT_APEX` | staging apex | `yayatoh.events` (decision D2) |
| `MARKETPLACE_HOSTS`, `APP_HOSTS` | staging hosts | leave unset (defaults are production's) |
| `MOBILE_CONFIG_JSON` | optional | `{"minimumVersions":{"ios":"…","android":"…"}}` |
| `MESSAGING_HELP_URL`, `SIGNUP_WAITLIST_URL` | optional | your support page / waitlist form |

## 3. Secrets you generate (one value per environment, never shared between them)

| Variable | How | ① | ② | S | P |
|---|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | gen | — | — | ✓ | ✓ |
| `APP_TOKEN_SECRET` | gen | — | — | ✓ | ✓ |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `pnpm vapid:generate` | — | — | ✓ | ✓ |
| `VAPID_SUBJECT` | `mailto:` your support address | — | — | ✓ | ✓ |
| `LEGACY_ORIGIN_SECRET` | gen; also given to the legacy nginx | — | — | ✓ | ✓ |

## 4. Provider switches: leave unset everywhere except where noted

The switch turns a real provider on; credentials alone do nothing. In both cloud environments **all switches stay unset** (fake providers). Staging turns them on one by one during the stabilise step; production only through the go-live runbook.

| Switch | Off (default) | On |
|---|---|---|
| `PAYMENTS_PROVIDER` | `fake` | `stripe`: staging (test keys) and production (live keys) only, per runbook, with your approval |
| `EMAIL_PROVIDER` | dev mailbox | `ses` |
| `SMS_PROVIDER` | dev mailbox | `twilio` |
| `WHATSAPP_PROVIDER` | dev mailbox | `cloud`, `gateway` or `cloud,gateway` |
| `SOCIAL_SIGN_IN_PROVIDER` | `fake` | `real` (production is always real) |
| `HUMAN_CHECK_PROVIDER` | `fake` | `turnstile` |
| `REALTIME_PROVIDER` | `sse` | `ably` |
| `MEDIA_STORE` | Postgres (refused in production) | `r2` (required in production) |
| `LEGACY_ORIGIN_URL`, `LEGACY_ABC_ORIGIN_URL` | front door off | the Laravel origins, at cutover (runbook `front-door.md`) |

## 5. Third-party credentials (from your accounts)

② = put the **test/sandbox** value in the `yayatoh-integrations` cloud environment. S = staging (test/sandbox). P = production (live).

| Service | Variables | ② test value | P |
|---|---|---|---|
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | `sk_test_…`/`pk_test_…` and the test-mode webhook secrets (live keys are refused outside production) | live keys, only at go-live |
| **Amazon SES** | `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `AWS_SES_SESSION_TOKEN` (only for temporary credentials), `SES_CONFIGURATION_SET`, `SES_SNS_TOPIC_ARN` | an IAM user limited to SES, account still in the SES sandbox | production IAM user |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | Twilio **test credentials** (they never send) | live account + 10DLC Messaging Service |
| **WhatsApp Cloud API** | `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_APP_SECRET`, `WHATSAPP_CLOUD_VERIFY_TOKEN` (gen) | Meta test number | business number |
| **WhatsApp gateway** (yours) | `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_KEY_ID`, `WHATSAPP_GATEWAY_SECRET` | a test key on the gateway | production key |
| **Google sign-in** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | an OAuth client for the staging origin | production OAuth client |
| **Apple sign-in** | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` (a JWT, renew within 6 months) | Services ID for staging | production Services ID |
| **Cloudflare Turnstile** | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare's published **test keys** | production widget keys |
| **Ably** | `ABLY_API_KEY` (`appId.keyId:secret`) | a sandbox app key | production app key |
| **Cloudflare R2** | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_MEDIA_BUCKET` | a separate test bucket and a token scoped to it | production bucket |
| **Front door tuning** (optional) | `LEGACY_YAY_HOSTS`, `LEGACY_ABC_HOSTS`, `FRONT_DOOR_TIMEOUT_MS`, `FRONT_DOOR_MAX_BODY`, `FRONT_DOOR_FLAG_TTL_MS`, `FRONT_DOOR_FLUSH_MS`, `REALTIME_MAX_STREAMS_PER_ORG` | — (defaults are fine) | only if the runbook says so |

Not in `.env.example` but in `docs/cloud-environment.md`: `NEON_API_KEY` (creates a Neon database branch per preview; S only).

## Checklist for the owner

1. **Doppler:** create the project with configs `dev`, `preview`, `staging`, `production`. Enter sections 2–3 and the switches you want per config, then the section 5 credentials (test values in dev/preview/staging, live values only in production).
2. **Cloud:** create the `yayatoh-integrations` environment (same setup script and network list as `yayatoh`, plus the hosts of any service you add: e.g. `email.*.amazonaws.com`, `api.twilio.com`, `graph.facebook.com`, `challenges.cloudflare.com`, `*.r2.cloudflarestorage.com`). Add only the ② test values, as **API credentials** where offered. Leave every switch unset.
3. **Leave `yayatoh` as it is.** The builders need nothing from this page.
4. Tell the orchestrator which services are in, by name only. It will plan the test-mode checks for the stabilise step.
