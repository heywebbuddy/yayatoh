# Spec: M7.2a — App sign-in

- **Milestone:** M7.2a (Phase 7 mobile; plan `docs/plans/mobile.md` row M7.2a, decisions P7-5 and P7-6)
- **Status:** built (2026-10-13). **Owner approval before main:** `auth` and `mobile-contract`.
- **Risk tags:** `auth`, `mobile-contract` (`/v1` additions only; oasdiff clean)
- **Related:** ADR 0010 (auth); M1.2f (refresh tokens, social sign-in, two-step verification); `docs/specs/M1.2/spec.md`

## 1. Goal and users
Attendees sign in to the mobile app with an emailed code, Sign in with Apple or Google, or the password
they already have. Accounts with two-step verification answer a second step. Commands that need a
recent "Confirm it's you" work over `/v1` bearer sessions. Later mobile increments (M7.2c, M7.2e) mount
their routes on a `/v1/me` scope for the signed-in person.

## 2. What was built
**`packages/auth`**
- `app-sign-in.ts` (`appSignIn(auth, { mailer, twoFactor, verifier })`):
  - `requestEmailCode` sends a six-digit code (10 minutes) the same way for known and unknown addresses.
  - `signInWithEmailCode` spends it; the first sign-in creates the account with the address verified. An
    account that never verified its address is promoted by the code and gets the web's pre-hijack reset
    (`resetUnverifiedAccount`, moved out of `confirmLinkProof` in `social.ts`).
  - `signInWithIdToken` verifies an Apple or Google id_token and applies the web's linking rules
    (`resolveSocialSignIn`): a linked identity signs in; the same email on an existing account needs the
    code emailed to that address first (`completeLinkProof`); otherwise a new verified account. An Apple
    private-relay address never matches another account.
  - Two-step verification: every first factor (password, code, provider, link proof) on a TOTP account ends in a
    single-use challenge (`yyc_…`, 5 minutes, 5 wrong codes) instead of tokens. `completeTwoFactor` takes an
    authenticator or backup code (replay protected, shared 5-in-15-minutes pause per person) and spends the
    challenge with a delete that returns the row, so two requests cannot both win.
  - `startStepUp` / `stepUp` wrap `twoFactorService`: authenticator, password or emailed code, by the
    person's own method.
- `id-token.ts`: the `IdTokenVerifier` port. The real adapter (`jwksIdTokenVerifier`, `jose`) checks the RS256
  signature against the provider's JWKS (fetched and cached), `iss`, `aud` (the apps' ids from
  `APPLE_MOBILE_CLIENT_IDS` / `GOOGLE_MOBILE_CLIENT_IDS`), `exp` (30 s tolerance), a future `iat`, and the nonce
  (Apple carries the SHA-256 of the raw nonce; Google carries it as given). The fake adapter (HMAC-signed claims,
  same checks) serves development, previews and CI; production is always real.
- `BearerSession` gains `user.emailVerified` and `stepUpAt` (a fixed-lifetime access token counts only an
  explicit sign-in or step-up; a refresh carries it over unchanged). The internal `TokenPair` gains `stepUpAt`; the wire `TokenPair.user` gains
  `user.emailVerified`. A sign-in that issues tokens starts stepped up.
- `twoFactorService.verifySignInCode` (the second step's code check).

**`/v1`** (`packages/api-v1`)
- `POST /auth/email-code` → `202 { expiresInSeconds }`, identical for known and unknown addresses; limited per
  address (5 per 15 minutes) and per client IP (30 per minute).
- `POST /auth/token` grants: `email_code`, `apple`, `google`, `two_factor`, `link_proof` (plus `password`,
  `refresh_token`, unchanged). A second step is `401 step_up_required` with `details.reason`
  `two_factor_required` (the password grant too, now with a challenge) or `email_proof_required`,
  `details.challenge` and `details.challengeExpiresAt`. Refusals are `401 unauthenticated` with
  `details.reason` (`invalid_credentials`, `invalid_code`, `too_many_attempts`, `invalid_challenge`,
  `invalid_id_token`, `provider_email_missing`, `provider_email_unverified`, `provider_linked_elsewhere`).
- `POST /auth/step-up/start` → `{ method: totp | password | email }` (emails the code for `email`, 5 per 15
  minutes); `POST /auth/step-up` → `{ stepUpAt, expiresAt }`. A wrong proof is `400` (so clients do not treat it
  as a dead token), five wrong in 15 minutes `429`.
- `orgScope` passes the session's `stepUpAt` into `ctx`, so commands marked `stepUp: true` work within
  `STEP_UP_WINDOW_MS` (10 minutes).
- **`/v1/me` scope** (`meScope`, exported from `@yayatoh/api-v1`): a user bearer session whose email is verified
  (an API key or no credential is `401`; an unverified email is `403` with `details.reason: email_unverified`).
  Routes read `c.get('me')` (`MeContext`: `session`, `user`, and a `ctx` with actor `user`, no org, `stepUpAt`).
  `/me` and `/me/organizations` predate the scope and stay open to unverified sessions.
- `User` gains `emailVerified`. `apps/api/openapi.json` and the SDK are regenerated.

**Composition:** `apps/api/src/auth.ts` (sealed two-step secrets like the web, dev mailbox for the last code,
`getAppSignIn`) and the web's `/api/v1` mount both pass `appSignIn` to `createV1`.

## 3. Not yet / later
- Live sign-in mail from `apps/api` (console mailer refuses in production; the web mount sends through SES) and
  the Apple/Google audiences in Doppler: `docs/owner-inbox.md`.
- The app screens and `mobile-core` helpers for each grant (M7.1c, M7.2b…).
- The web's own "unverified account signs in by emailed code" error (Better Auth's lock row id is not a UUID on
  `auth.verifications`): noted in the inbox, not touched.

## 4. Acceptance
| Criterion | Test |
|---|---|
| A two-factor account never gets tokens without a valid TOTP or backup code, from any grant | `packages/api-v1/tests/app-sign-in.int.test.ts` (two-factor accounts), `packages/auth/tests/app-sign-in.int.test.ts` (two-factor step) |
| A challenge works once and expires after 5 minutes; five wrong codes spend it | same files |
| An id_token with a wrong audience, issuer, signature, expiry or nonce is refused; a valid Apple token with an unknown relay email creates a new account | `packages/auth/tests/id-token.test.ts`, `packages/auth/tests/app-sign-in.int.test.ts` (Apple and Google), `packages/api-v1/tests/app-sign-in.int.test.ts` (grantType apple and google) |
| Linking to an existing account needs the emailed proof | `packages/auth/tests/app-sign-in.int.test.ts`, `packages/api-v1/tests/app-sign-in.int.test.ts` |
| Unknown and known emails get identical email-code responses; attempts are limited; codes expire | `packages/api-v1/tests/app-sign-in.int.test.ts` (email-code, grantType email_code), `packages/auth/tests/app-sign-in.int.test.ts` (email code) |
| A `stepUp` command over `/v1` fails without a fresh step-up and passes within the window | `packages/api-v1/tests/app-sign-in.int.test.ts` (step-up on a bearer session), `packages/api-v1/tests/me-scope.int.test.ts` |
| The `/v1/me` scope refuses unverified emails, API keys and anonymous callers | `packages/api-v1/tests/me-scope.int.test.ts` |
| Refresh rotation and family revoke are unchanged | `packages/auth/tests/sign-in-extras.int.test.ts`, `packages/api-v1/tests/v1.int.test.ts` (unchanged), `app-sign-in.int.test.ts` (refresh and revoke) |
| `/v1` changes are additions only | `oasdiff breaking` against `origin/main`: none; `pnpm contracts:check` |

## 5. Gate (2026-10-13)
- `pnpm lint`, `pnpm check:modules`, `pnpm turbo run typecheck` (all 60 packages; `worker` and `compliance` need an 8–9 GB heap), `pnpm contracts:check`, `oasdiff breaking` against `origin/main` (no findings): green.
- Unit: 4160 passed, 1 failed (`packages/modules/media/tests/golden.test.ts`, a recorded image hash; the media module is untouched, so this is the sharp/libvips build in this container).
- Integration: 2398 passed, 1 failed (`tools/automation-apps/tests/apps.int.test.ts`, "trigger subscriptions": `400 dns` because `hook.eu1.make.com` does not resolve in this container).
- E2E: `apps/web/e2e/maintenance.spec.ts` (the only spec calling `/api/v1/auth/login`) on mobile-375, tablet-768 and desktop-1280: 6 passed. A smoke run against the built web app's `/api/v1` mount: email code → tokens → `/me` (`emailVerified: true`) → `step-up/start`.
- No web screens changed, so no new browser tests. The apps' screens come with M7.1c and the M7.2b–e increments.
