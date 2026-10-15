import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type AppSignInResult, isTwoFactorError } from '@yayatoh/auth';
import { DomainError, STEP_UP_WINDOW_MS } from '@yayatoh/kernel';
import type { RateLimitPolicyName } from '@yayatoh/platform/security';
import { deleteAccount } from '@yayatoh/privacy';
import { myOrganizations } from '@yayatoh/tenancy';
import { accountNotifier } from '../account-mail.ts';
import type { V1Deps, V1Env } from '../context.ts';
import { platformLimiter } from '../platform-limiter.ts';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit.ts';
import { listSchema, Membership, MobileConfig, Session, TokenPair, toWire, User } from '../resources.ts';
import { mobileApps, resolveMobile } from '../versions.ts';
import { body, json, problems, userSecurity, writeProblems } from './common.ts';
import { API_VERSION } from './version.ts';

const LoginBody = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .openapi('LoginRequest');

const Nonce = z.string().min(16).max(200).openapi({
  description:
    'A random value the app makes for this attempt and gives the platform’s sign-in sheet. For Apple the sheet puts its SHA-256 (hex) in the id_token; for Google it is carried as given.',
});
const Code = z.string().min(1).max(32);

const TokenBody = z
  .discriminatedUnion('grantType', [
    z.object({
      grantType: z.literal('password'),
      email: z.email().max(254),
      password: z.string().min(1).max(128),
    }),
    z.object({ grantType: z.literal('refresh_token'), refreshToken: z.string().min(1).max(200) }),
    z.object({
      grantType: z.literal('email_code'),
      email: z.email().max(254),
      code: Code.openapi({ description: 'The six-digit code from `POST /auth/email-code`.' }),
    }),
    z.object({
      grantType: z.literal('apple'),
      idToken: z.string().min(1).max(8192),
      nonce: Nonce,
      name: z.string().trim().min(1).max(200).optional().openapi({
        description: 'The name Apple gives the app on the first sign-in only (it is not in the id_token).',
      }),
    }),
    z.object({
      grantType: z.literal('google'),
      idToken: z.string().min(1).max(8192),
      nonce: Nonce,
    }),
    z.object({
      grantType: z.literal('two_factor'),
      challenge: z.string().min(1).max(100),
      code: Code.openapi({ description: 'An authenticator code or a backup code.' }),
    }),
    z.object({
      grantType: z.literal('link_proof'),
      challenge: z.string().min(1).max(100),
      code: Code.openapi({ description: 'The six-digit code emailed to the existing account’s address.' }),
    }),
  ])
  .openapi('TokenRequest');

const token = createRoute({
  method: 'post',
  path: '/auth/token',
  operationId: 'issueToken',
  tags: ['auth'],
  summary:
    'Sign in or refresh: a 15-minute access token and a rotating refresh token (grantType password, email_code, apple, google, two_factor, link_proof or refresh_token)',
  description: [
    'Each refresh spends the refresh token and returns a new pair; the previous access token ends. A spent refresh token presented again revokes its whole chain (every access token issued from it ends), answering `401` with `reason: refresh_token_reused`.',
    '',
    '**Grants.** `password`: email and password. `email_code`: the code from `POST /auth/email-code`; the first sign-in creates the account with the address verified. `apple` and `google`: the native sheet’s `idToken` with the `nonce` the app gave it; the token’s signature, issuer, audience, expiry and nonce are checked. `two_factor` and `link_proof`: finish a step the platform asked for (below).',
    '',
    '**Steps.** An account with two-step verification never gets tokens from a first factor (`password`, `email_code`, `apple`, `google`, `link_proof`): the answer is `401 step_up_required` with `details.reason: two_factor_required`, a single-use `details.challenge` and `details.challengeExpiresAt` (five minutes). Send it with an authenticator or backup code as grant `two_factor`. A provider sign-in whose verified email matches an existing account that has not linked it answers `401 step_up_required` with `details.reason: email_proof_required`: a code was emailed to that address; send it with the `challenge` as grant `link_proof`.',
    '',
    '**Refusals** are `401 unauthenticated` with `details.reason`: `invalid_credentials`, `invalid_code`, `too_many_attempts` (start the sign-in again), `invalid_challenge` (unknown, spent or expired), `invalid_id_token`, `provider_email_missing`, `provider_email_unverified`, `provider_linked_elsewhere`; or `429 rate_limited`.',
  ].join('\n'),
  request: body(TokenBody),
  responses: { 200: json(TokenPair, 'Tokens'), ...problems },
});

const EmailCodeBody = z.object({ email: z.email().max(254) }).openapi('EmailCodeRequest');
const EmailCodeRequested = z
  .object({
    expiresInSeconds: z.number().int().openapi({ description: 'How long the code works.' }),
  })
  .openapi('EmailCodeRequested');

const emailCode = createRoute({
  method: 'post',
  path: '/auth/email-code',
  operationId: 'requestEmailCode',
  tags: ['auth'],
  summary: 'Email a six-digit sign-in code',
  description:
    'Sends a code to the address and answers `202` with the same body whether or not the address has an account: the first sign-in with the code creates it. Spend the code with `POST /auth/token` (grantType `email_code`). Limited per address (5 per 15 min) and per client IP.',
  request: body(EmailCodeBody),
  responses: {
    202: json(EmailCodeRequested, 'A code was sent if the address can receive mail'),
    ...problems,
  },
});

const StepUpMethod = z.enum(['totp', 'password', 'email']).openapi('StepUpMethod', {
  description:
    'How this person confirms it is them: their authenticator (if set up), else their password, else an emailed code.',
});
const StepUpStarted = z.object({ method: StepUpMethod }).openapi('StepUpStarted');
const StepUpBody = z
  .discriminatedUnion('method', [
    z.object({ method: z.literal('totp'), code: Code }),
    z.object({ method: z.literal('email'), code: Code }),
    z.object({ method: z.literal('password'), password: z.string().min(1).max(128) }),
  ])
  .openapi('StepUpRequest');
const StepUpResult = z
  .object({
    stepUpAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).openapi({
      description: 'Commands that need a recent step-up pass until this time.',
    }),
  })
  .openapi('StepUpResult');

const stepUpStart = createRoute({
  method: 'post',
  path: '/auth/step-up/start',
  operationId: 'startStepUp',
  tags: ['auth'],
  summary:
    'Which proof the signed-in person must give to step up (emails the code when it is an emailed one)',
  description:
    'Answers with the method (`totp`, `password` or `email`). For `email` a six-digit code is sent to the person’s address (5 per 15 min). Then send the proof to `POST /auth/step-up`.',
  security: userSecurity,
  responses: { 200: json(StepUpStarted, 'The method to use'), ...problems },
});
const stepUp = createRoute({
  method: 'post',
  path: '/auth/step-up',
  operationId: 'stepUp',
  tags: ['auth'],
  summary: 'Confirm it is you: commands that need a recent step-up pass for the next few minutes',
  description:
    'Checks an authenticator or backup code (`totp`), the password, or an emailed code (`email`; the method must be the person’s own, see `POST /auth/step-up/start`) and stamps this session. A command that needs a step-up and finds none fresh answers `401 step_up_required`. A wrong proof answers `400 validation_failed` with `details.reason` `invalid_code` or `invalid_password`; five wrong proofs in 15 minutes answer `429`. A fresh sign-in counts as a step-up.',
  security: userSecurity,
  request: body(StepUpBody),
  responses: { 200: json(StepUpResult, 'The session is stepped up'), ...problems },
});

const RevokeBody = z.object({ refreshToken: z.string().min(1).max(200) }).openapi('RevokeRequest');

const revoke = createRoute({
  method: 'post',
  path: '/auth/revoke',
  operationId: 'revokeToken',
  tags: ['auth'],
  summary: 'Sign out a refresh token: its chain and every access token issued from it end',
  description:
    'Revokes the refresh token’s whole chain: every access token issued from it stops working. Unknown or already revoked tokens also answer `204`.',
  request: body(RevokeBody),
  responses: { 204: { description: 'Revoked (unknown tokens too)' }, ...problems },
});

const login = createRoute({
  method: 'post',
  path: '/auth/login',
  operationId: 'login',
  tags: ['auth'],
  summary: 'Sign in with email and password; returns a bearer session token (no cookies)',
  description:
    'Signs in with email and password and returns a session token to send as `Authorization: Bearer <token>`. No cookie is set. Accounts with two-factor sign-in get `step_up_required`: use the web sign-in. Limited per account (5 per 15 min) and per IP.',
  request: body(LoginBody),
  responses: { 200: json(Session, 'Signed in'), ...problems },
});
const refresh = createRoute({
  method: 'post',
  path: '/auth/refresh',
  operationId: 'refreshSession',
  tags: ['auth'],
  summary: 'Keep a session alive: returns the token with its extended expiry',
  description: 'Slides the session’s expiry forward and returns the same token with its new expiry.',
  security: userSecurity,
  responses: { 200: json(Session, 'The session'), ...problems },
});
const logout = createRoute({
  method: 'post',
  path: '/auth/logout',
  operationId: 'logout',
  tags: ['auth'],
  summary: 'End the session; the token stops working at once',
  description: 'Ends the session: the token is refused from the next request on.',
  security: userSecurity,
  responses: { 204: { description: 'Signed out' }, ...problems },
});
const me = createRoute({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  tags: ['me'],
  summary: 'The signed-in user',
  description: 'The user behind the bearer session. API keys are not users: they get 401 here.',
  security: userSecurity,
  responses: { 200: json(User, 'The user'), ...problems },
});
const signOutEverywhere = createRoute({
  method: 'post',
  path: '/auth/sign-out-everywhere',
  operationId: 'signOutEverywhere',
  tags: ['auth'],
  summary: 'Sign out of every device and session',
  description:
    'Ends every session of the signed-in person (the web, tenant sites and API clients) and revokes every refresh-token family, so no phone can refresh its way back in. The access token used for this call ends too. Answers `204`.',
  security: userSecurity,
  responses: { 204: { description: 'Signed out everywhere' }, ...problems },
});
const AccountErasure = z
  .object({
    requestId: z.uuid().openapi({ description: 'The recorded erasure request.' }),
    summary: z
      .object({
        organizations: z.number().int(),
        memberships: z.number().int(),
        ordersUnlinked: z.number().int(),
        invitations: z.number().int(),
        sessions: z.number().int(),
        credentials: z.number().int(),
        signupCodes: z.number().int(),
      })
      .openapi({ description: 'How much was detached or removed, per category (counts only).' }),
  })
  .openapi('AccountErasure');
const deleteMe = createRoute({
  method: 'delete',
  path: '/me',
  operationId: 'deleteMe',
  tags: ['me'],
  summary: 'Delete the signed-in person’s account (needs a fresh step-up)',
  description: [
    'Deletes the account as the web’s account page does (App Store rule 5.1.1(v)): the person’s sign-in methods, sessions and refresh tokens end, their address joins the suppression list, and a confirmation goes to the old address. Organizers keep their orders, tickets and consents as the controllers of those records; they lose the link to the account.',
    '',
    'Needs a step-up within the last ten minutes (`POST /auth/step-up`); without one the answer is `401 step_up_required` and nothing is deleted. Refused with `409 invalid_state` (`details.reason: last_owner`, `details.orgs`: names) while the person is the only owner of an organization. Works for sessions whose email is not yet verified. Refused with `403 forbidden` (`details.reason: impersonation`) while a staff member is acting as the person.',
  ].join('\n'),
  security: userSecurity,
  responses: { 200: json(AccountErasure, 'Deleted'), ...writeProblems },
});
const myOrgs = createRoute({
  method: 'get',
  path: '/me/organizations',
  operationId: 'listMyOrganizations',
  tags: ['me'],
  summary: 'Organizations the signed-in user belongs to, with their role',
  description: 'Every organization the signed-in user is a member of, with their role in it.',
  security: userSecurity,
  responses: { 200: json(listSchema(Membership, 'MembershipList'), 'Memberships'), ...problems },
});
const mobileConfig = createRoute({
  method: 'get',
  path: '/mobile/config',
  operationId: 'getMobileConfig',
  tags: ['mobile'],
  summary: 'Minimum and latest app versions, base URLs and feature flags (public)',
  description:
    'Minimum and latest app versions per platform and per app (`apps`), the base URLs and feature flags. No credential. An app below its `minimumVersion` gets `426 Upgrade Required` (problem+json, code `upgrade_required`, `details.storeUrl`) from every other route; this one always answers.',
  responses: { 200: json(MobileConfig, 'Mobile configuration') },
});

/**
 * The problem for a sign-in that did not end in tokens. Steps (`step_up_required`) carry the
 * challenge to answer; refusals are `unauthenticated` with a stable `details.reason`.
 */
function refuse(r: Extract<AppSignInResult, { ok: false }>): never {
  switch (r.reason) {
    case 'two_factor_required':
      throw new DomainError('step_up_required', 'Enter the code from your authenticator app', {
        reason: 'two_factor_required',
        challenge: r.challenge.token,
        challengeExpiresAt: r.challenge.expiresAt.toISOString(),
      });
    case 'link_proof_required':
      throw new DomainError('step_up_required', 'Enter the code we emailed to confirm this address', {
        reason: 'email_proof_required',
        challenge: r.challenge.token,
        challengeExpiresAt: r.challenge.expiresAt.toISOString(),
      });
    case 'rate_limited':
      throw new DomainError('rate_limited', 'Too many wrong codes', { retryAfter: 15 * 60 });
    case 'invalid_code':
    case 'too_many_attempts':
    case 'invalid_challenge':
    case 'invalid_id_token':
    case 'provider_email_missing':
    case 'provider_email_unverified':
    case 'provider_linked_elsewhere':
      throw new DomainError('unauthenticated', 'The sign-in could not be completed', { reason: r.reason });
  }
}

function userOf(c: { get(k: 'principal'): V1Env['Variables']['principal'] }) {
  const p = c.get('principal');
  if (p?.kind !== 'user') throw new DomainError('unauthenticated', 'A user session is required');
  return p.session;
}

/** The person's own session: commands about the account itself never run under an impersonation. */
function ownSessionOf(c: { get(k: 'principal'): V1Env['Variables']['principal'] }) {
  const s = userOf(c);
  if (s.impersonated)
    throw new DomainError('forbidden', 'Not available while a staff member is acting as this person', {
      reason: 'impersonation',
    });
  return s;
}

export function authRoutes(deps: V1Deps, limiter: RateLimiter, ipOf: (h: Headers) => string) {
  const mobile = resolveMobile(deps.mobile);
  const sessions = () => {
    if (!deps.sessions) throw new DomainError('not_found', 'Sessions are not available on this host');
    return deps.sessions();
  };
  const loginLimits = (email: string, ip: string) => {
    // Per account (5 per 15 min) and per IP (100 per min): brute force is slowed, venues are not locked out.
    for (const [key, rule] of [
      [`login:acct:${email.toLowerCase()}`, RATE_LIMITS.loginAccount],
      [`login:ip:${ip}`, RATE_LIMITS.loginIp],
    ] as const) {
      const d = limiter.take(key, rule.limit, rule.window);
      if (!d.allowed)
        throw new DomainError('rate_limited', 'Too many sign-in attempts', { retryAfter: d.resetSeconds });
    }
  };
  const appSignIn = () => {
    if (!deps.appSignIn) throw new DomainError('not_found', 'App sign-in is not available on this host');
    return deps.appSignIn();
  };
  const takeOrThrow = (key: string, rule: { limit: number; window: number }) => {
    const d = limiter.take(key, rule.limit, rule.window);
    if (!d.allowed)
      throw new DomainError('rate_limited', 'Too many attempts', { retryAfter: d.resetSeconds });
  };
  /**
   * The counters every server instance shares (M7.x): the in-memory buckets above are per instance,
   * so on a serverless host an attacker could spread guesses and emails across instances. The
   * address or challenge under attack is the identity; the IP budgets are generous (venue Wi-Fi).
   */
  const sharedTake = async (
    policy: RateLimitPolicyName,
    subject: { readonly ip: string; readonly identity: string },
  ) => {
    const d = await (deps.authLimiter ?? platformLimiter()).check(policy, subject);
    if (!d.allowed)
      throw new DomainError('rate_limited', 'Too many attempts', {
        retryAfter: Math.max(1, Math.ceil(d.retryAfterMs / 1000)),
      });
  };
  return new OpenAPIHono<V1Env>()
    .openapi(token, async (c) => {
      const req = c.req.valid('json');
      const ip = ipOf(c.req.raw.headers);
      if (req.grantType === 'refresh_token') {
        const d = limiter.take(`refresh:ip:${ip}`, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.window);
        if (!d.allowed)
          throw new DomainError('rate_limited', 'Too many requests', { retryAfter: d.resetSeconds });
        const r = await sessions().refresh(req.refreshToken);
        if (!r.ok)
          throw new DomainError('unauthenticated', 'The refresh token cannot be used', {
            reason: r.reason === 'reused' ? 'refresh_token_reused' : `refresh_token_${r.reason}`,
          });
        return c.json(toWire(TokenPair, { ...r.tokens, tokenType: 'bearer' }), 200);
      }
      if (req.grantType === 'password') {
        loginLimits(req.email, ip);
        const r = await sessions().signInForTokens(req.email, req.password);
        if (!r.ok) {
          if (r.reason === 'two_factor_required') {
            // The password is right: open the second step where the deployment can (M7.2a).
            const challenge = deps.appSignIn ? await deps.appSignIn().challengeForPassword(req.email) : null;
            if (challenge) return refuse({ ok: false, reason: 'two_factor_required', challenge });
            throw new DomainError(
              'step_up_required',
              'This account uses two-factor sign-in; use the web sign-in',
              { reason: 'two_factor_required' },
            );
          }
          throw new DomainError('unauthenticated', 'Wrong email or password', {
            reason: 'invalid_credentials',
          });
        }
        return c.json(toWire(TokenPair, { ...r.tokens, tokenType: 'bearer' }), 200);
      }
      const app = appSignIn();
      let r: AppSignInResult;
      switch (req.grantType) {
        case 'email_code':
          takeOrThrow(`emailcode:verify:${req.email.toLowerCase()}`, RATE_LIMITS.loginAccount);
          takeOrThrow(`emailcode:verify:ip:${ip}`, RATE_LIMITS.loginIp);
          await sharedTake('appSignInVerify', { ip, identity: req.email });
          r = await app.signInWithEmailCode(req.email, req.code);
          break;
        case 'apple':
        case 'google':
          takeOrThrow(`idtoken:ip:${ip}`, RATE_LIMITS.loginIp);
          r = await app.signInWithIdToken({
            provider: req.grantType,
            idToken: req.idToken,
            nonce: req.nonce,
            name: req.grantType === 'apple' ? (req.name ?? null) : null,
          });
          break;
        case 'two_factor':
          takeOrThrow(`challenge:ip:${ip}`, RATE_LIMITS.loginIp);
          await sharedTake('appSignInVerify', { ip, identity: req.challenge });
          r = await app.completeTwoFactor(req.challenge, req.code);
          break;
        case 'link_proof':
          takeOrThrow(`challenge:ip:${ip}`, RATE_LIMITS.loginIp);
          await sharedTake('appSignInVerify', { ip, identity: req.challenge });
          r = await app.completeLinkProof(req.challenge, req.code);
          break;
      }
      if (!r.ok) return refuse(r);
      return c.json(toWire(TokenPair, { ...r.tokens, tokenType: 'bearer' }), 200);
    })
    .openapi(emailCode, async (c) => {
      const { email } = c.req.valid('json');
      const ip = ipOf(c.req.raw.headers);
      takeOrThrow(`emailcode:acct:${email.toLowerCase()}`, RATE_LIMITS.emailCodeAccount);
      takeOrThrow(`emailcode:ip:${ip}`, RATE_LIMITS.emailCodeIp);
      await sharedTake('appEmailCode', { ip, identity: email });
      return c.json(toWire(EmailCodeRequested, await appSignIn().requestEmailCode(email)), 202);
    })
    .openapi(stepUpStart, async (c) => {
      const s = userOf(c);
      takeOrThrow(`stepup:mail:${s.user.id}`, RATE_LIMITS.stepUpMail);
      await sharedTake('appStepUpMail', { ip: ipOf(c.req.raw.headers), identity: s.user.id });
      const method = await appSignIn().startStepUp(s.user.id, s.user.email);
      return c.json(toWire(StepUpStarted, { method }), 200);
    })
    .openapi(stepUp, async (c) => {
      const s = userOf(c);
      const proof = c.req.valid('json');
      let at: Date;
      try {
        at = await appSignIn().stepUp({
          userId: s.user.id,
          sessionToken: s.token,
          proof: proof.method === 'password' ? { method: 'password', password: proof.password } : proof,
        });
      } catch (err) {
        if (!isTwoFactorError(err)) throw err;
        if (err.code === 'rate_limited')
          throw new DomainError('rate_limited', 'Too many wrong codes', { retryAfter: 15 * 60 });
        throw new DomainError('validation_failed', 'That did not confirm it is you', { reason: err.code });
      }
      return c.json(
        toWire(StepUpResult, { stepUpAt: at, expiresAt: new Date(at.getTime() + STEP_UP_WINDOW_MS) }),
        200,
      );
    })
    .openapi(signOutEverywhere, async (c) => {
      await appSignIn().signOutEverywhere(ownSessionOf(c).user.id);
      return c.body(null, 204);
    })
    .openapi(revoke, async (c) => {
      await sessions().revokeRefresh(c.req.valid('json').refreshToken);
      return c.body(null, 204);
    })
    .openapi(login, async (c) => {
      const { email, password } = c.req.valid('json');
      loginLimits(email, ipOf(c.req.raw.headers));
      const r = await sessions().signIn(email, password);
      if (!r.ok) {
        throw r.reason === 'two_factor_required'
          ? new DomainError('step_up_required', 'This account uses two-factor sign-in; use the web sign-in', {
              reason: 'two_factor_required',
            })
          : new DomainError('unauthenticated', 'Wrong email or password', { reason: 'invalid_credentials' });
      }
      return c.json(toWire(Session, { ...r.session, tokenType: 'bearer' }), 200);
    })
    .openapi(refresh, async (c) => {
      const s = userOf(c);
      const fresh = (await sessions().session(s.token)) ?? s;
      return c.json(toWire(Session, { ...fresh, tokenType: 'bearer' }), 200);
    })
    .openapi(logout, async (c) => {
      await sessions().signOut(userOf(c).token);
      return c.body(null, 204);
    })
    .openapi(me, (c) => c.json(toWire(User, userOf(c).user), 200))
    .openapi(deleteMe, async (c) => {
      const s = ownSessionOf(c);
      // The same command as the web's account page: the step-up, the last-owner rule, each org's
      // detach and the anonymising all happen inside `deleteAccount`.
      const r = await deleteAccount({
        userId: s.user.id,
        email: s.user.email,
        by: { type: 'self' },
        ports: deps.ports,
        notify: deps.accountNotice ?? accountNotifier,
        stepUpAt: s.stepUpAt,
      });
      return c.json(toWire(AccountErasure, r), 200);
    })
    .openapi(myOrgs, async (c) => {
      const orgs = await myOrganizations(userOf(c).user.id);
      return c.json(
        toWire(listSchema(Membership, 'MembershipList'), {
          data: orgs.map((o) => ({ id: o.orgId, slug: o.slug, name: o.name, role: o.role })),
        }),
        200,
      );
    })
    .openapi(mobileConfig, (c) =>
      c.json(toWire(MobileConfig, { apiVersion: API_VERSION, ...mobile, apps: mobileApps(mobile) }), 200),
    );
}
