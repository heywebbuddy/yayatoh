import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createPortalBearerSession,
  endPortalBearerSession,
  PORTAL_CODE_TTL_MS,
  PORTAL_LINK_TTL_MS,
  type PortalBearerTokens,
  type PortalLimits,
  type PortalPrincipal,
  portalCtx,
  portalPrincipalByBearer,
  refreshPortalBearerSession,
  requestPortalChallenge,
  resendPortalInvitations,
  verifyPortalChallenge,
} from '@yayatoh/events';
import { DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  leadSetupQuery,
  MAX_QUALIFIERS,
  myLeadsQuery,
  NOTES_MAX,
  QUALIFIER_MAX,
  RATINGS,
  SCAN_REFUSALS,
  SHARED_FIELDS,
  SYNC_BATCH_MAX,
  syncLeadScansCommand,
  updateLeadCommand,
} from '@yayatoh/leads';
import { postgresRateLimitStore } from '@yayatoh/platform';
import {
  createRateLimiter,
  type RateLimiter as PlatformRateLimiter,
  type RateLimitStore,
  upstashRateLimitStore,
} from '@yayatoh/platform/security';
import { createMiddleware } from 'hono/factory';
import type { V1Deps, V1Env } from '../context.ts';
import { portalMailer } from '../portal-mail.ts';
import { toWire } from '../resources.ts';
import { body, json, problems, writeProblems } from './common.ts';

/**
 * M7.2e, the Staff app's exhibitor-rep side (P7-6): the portal sign-in by email code (P5-7,
 * the M1.5f rules, the same functions as the browser) returning bearer tokens in the shape of
 * M1.2f's, and the lead-retrieval routes (M5.6b) the Scan PWA's lead mode uses, over those tokens.
 * A rep is scoped to one exhibitor at one event by their portal account; the lead commands
 * re-check the account on every call (licence P5-4, the P5-8 allowlist, own leads only).
 */
type Env = { Variables: V1Env['Variables'] & { portal: PortalPrincipal } };

const portalSecurity = [{ portalSession: [] }];
const iso = z.iso.datetime({ offset: true });

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

let defaultLimiter: PlatformRateLimiter | undefined;
/** The M1.14 limiter as the web app builds it: Upstash when configured, otherwise Postgres counters. */
function platformLimiter(): PlatformRateLimiter {
  if (!defaultLimiter) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const store: RateLimitStore =
      url && token ? upstashRateLimitStore({ url, token }) : postgresRateLimitStore;
    defaultLimiter = createRateLimiter(store, (err) =>
      console.error(JSON.stringify({ rateLimit: 'store_error', message: String(err) })),
    );
  }
  return defaultLimiter;
}

const localeOf = (h: Headers) => {
  const asked = (h.get('accept-language') ?? 'en').split(/[,;]/)[0]?.trim() ?? 'en';
  return LOCALE.test(asked) ? asked : 'en';
};

const retryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/* -------------------------------------------------------------------------- sign in ---- */

const InviteToken = z.string().min(40).max(300).openapi({
  description:
    'The token in the emailed invitation link (`…/event-portal/invite/{token}`, or the app link built from it).',
});

const CodeRequestBody = z.object({ inviteToken: InviteToken }).openapi('PortalCodeRequest');

const CodeRequestStatus = z.enum(['sent', 'cooldown']).openapi('PortalCodeStatus');
const CodeRequested = z
  .object({
    status: CodeRequestStatus.openapi({
      description:
        '`sent`: a code was emailed; `cooldown`: one was sent less than 30 seconds ago (use that one).',
    }),
    challengeId: z.uuid().openapi({ description: 'Send it back with the code.' }),
    resendAt: iso.openapi({ description: 'When another code may be requested.' }),
  })
  .openapi('PortalCodeRequested');

const requestCode = createRoute({
  method: 'post',
  path: '/portal/auth/code',
  operationId: 'requestPortalCode',
  tags: ['portal'],
  summary: 'Email a sign-in code for a portal invitation',
  description:
    'Emails a six-digit code (10 minutes, single use; five wrong tries lock it) to the invited address. A forged, reissued, revoked or expired invitation answers 403 `forbidden`, the same as on the web. Limited per device, IP and address. No credential.',
  request: body(CodeRequestBody),
  responses: {
    200: json(CodeRequested, 'The code was sent'),
    403: problems[403],
    400: problems[400],
    429: problems[429],
  },
});

const PortalCodeGrant = z
  .object({
    grantType: z.literal('code'),
    inviteToken: InviteToken,
    challengeId: z.uuid(),
    code: z
      .string()
      .regex(/^\s*\d{3}\s?\d{3}\s*$/)
      .openapi({ description: 'The six-digit code from the email.' }),
  })
  .openapi('PortalCodeGrant');
const PortalRefreshGrant = z
  .object({ grantType: z.literal('refresh_token'), refreshToken: z.string().min(1).max(200) })
  .openapi('PortalRefreshGrant');
const PortalTokenBody = z
  .discriminatedUnion('grantType', [PortalCodeGrant, PortalRefreshGrant])
  .openapi('PortalTokenRequest');

const PortalTokenPair = z
  .object({
    accessToken: z.string().openapi({ description: 'Send as `Authorization: Bearer …` (15 minutes).' }),
    refreshToken: z
      .string()
      .openapi({ description: 'Spent by the next refresh; keep it in secure storage.' }),
    tokenType: z.literal('bearer'),
    expiresIn: z.int().openapi({ description: 'Seconds until the access token ends.' }),
    expiresAt: iso,
    refreshExpiresAt: iso.openapi({ description: 'When the session ends (a week, or the account’s end).' }),
  })
  .openapi('PortalTokenPair');

const issuePortalToken = createRoute({
  method: 'post',
  path: '/portal/auth/token',
  operationId: 'issuePortalToken',
  tags: ['portal'],
  summary: 'Sign in with the emailed code (grantType code) or refresh (grantType refresh_token)',
  description:
    'A right code returns a 15-minute access token and a rotating refresh token. Each refresh spends the refresh token and returns a new pair; a spent one presented again ends the session (`401`, `reason: refresh_token_reused`). A wrong code answers `401` with `reason: wrong_code` and `attemptsLeft`; the fifth wrong try locks the code (`code_locked`). No credential.',
  request: body(PortalTokenBody),
  responses: { 200: json(PortalTokenPair, 'Tokens'), ...problems },
});

const PortalRevokeBody = z
  .object({ refreshToken: z.string().min(1).max(200) })
  .openapi('PortalRevokeRequest');
const revokePortalToken = createRoute({
  method: 'post',
  path: '/portal/auth/revoke',
  operationId: 'revokePortalToken',
  tags: ['portal'],
  summary: 'Sign out: the session ends, access and refresh token both',
  description: 'Unknown or already ended tokens also answer `204`. No credential.',
  request: body(PortalRevokeBody),
  responses: { 204: { description: 'Signed out' }, 400: problems[400], 429: problems[429] },
});

const InvitationsBody = z
  .object({
    siteToken: z
      .string()
      .min(40)
      .max(300)
      .openapi({ description: 'The token of the event’s portal sign-in page link.' }),
    email: z.email().max(254),
  })
  .openapi('PortalInvitationsRequest');
const resendInvitations = createRoute({
  method: 'post',
  path: '/portal/auth/invitations',
  operationId: 'resendPortalInvitations',
  tags: ['portal'],
  summary: 'Email me my invitation again',
  description:
    'For someone who lost their invitation: emails the current invitation link of every live account of that address at the event. The answer is `204` whether or not the address has access (no enumeration). Limited per device, IP and address. No credential.',
  request: body(InvitationsBody),
  responses: { 204: { description: 'Done' }, 400: problems[400], 403: problems[403], 429: problems[429] },
});

/* --------------------------------------------------------------------------- leads ---- */

const LeadRating = z.enum(RATINGS).openapi('LeadRating');
const LeadSharedField = z.enum(SHARED_FIELDS).openapi('LeadSharedField');
const LeadLicense = z.enum(['licensed', 'unlicensed', 'over_allowance']).openapi('LeadLicenseStanding');
const LeadCaptureState = z.enum(['not_open', 'open', 'closed']).openapi('LeadCaptureState');
const ExhibitorPortalRole = z.enum(['exhibitor_admin', 'exhibitor_staff']).openapi('ExhibitorPortalRole');
const LeadScope = z.enum(['all', 'team', 'own']).openapi('LeadScope');
const LeadScanStatus = z.enum(['captured', 'rescanned', 'refused']).openapi('LeadScanStatus');
const LeadScanRefusal = z.enum(SCAN_REFUSALS).openapi('LeadScanRefusal');

const LeadSetup = z
  .object({
    eventName: z.string(),
    timezone: z.string(),
    exhibitorName: z.string(),
    role: ExhibitorPortalRole,
    email: z.string(),
    license: LeadLicense.openapi({
      description: 'A rep without a licence (`unlicensed`, `over_allowance`) cannot scan.',
    }),
    termsAccepted: z.boolean().openapi({ description: 'The exhibitor admin accepted the lead terms.' }),
    termsVersion: z.int(),
    capture: z.object({
      state: LeadCaptureState,
      opensAt: iso,
      closesAt: iso,
      accessUntil: iso,
      accessOpen: z.boolean(),
    }),
    qualifiers: z
      .array(z.string())
      .openapi({ description: 'The exhibitor’s qualifier labels a lead can carry.' }),
    teamVisibility: z.boolean(),
    leadCount: z
      .int()
      .openapi({ description: 'Admin only: how many leads the exhibitor has (0 for staff).' }),
  })
  .openapi('LeadSetup');

const Lead = z
  .object({
    id: z.uuid(),
    name: z.string(),
    jobTitle: z.string(),
    company: z.string(),
    email: z.string().nullable().openapi({ description: 'Only if the attendee agreed to share it (P5-8).' }),
    sharedFields: z.array(LeadSharedField),
    emailConsentVersion: z.int().nullable(),
    emailWithdrawnAt: iso.nullable(),
    rating: LeadRating.nullable(),
    qualifiers: z.array(z.string()),
    notes: z.string(),
    capturedAt: iso,
    lastScannedAt: iso,
    scans: z.int(),
    scannedByMe: z.boolean(),
    scannedBy: z.string().nullable(),
  })
  .openapi('Lead');

const LeadList = z.object({ leads: z.array(Lead), scope: LeadScope }).openapi('LeadList');

const getSetup = createRoute({
  method: 'get',
  path: '/portal/leads/setup',
  operationId: 'getLeadSetup',
  tags: ['portal'],
  summary: 'Lead mode: the rep’s licence, the lead terms, the capture window and the qualifiers',
  description:
    'For the signed-in exhibitor rep: which exhibitor and event, whether they hold a lead licence within the allowance, whether the terms are accepted, the capture window (opens 24 hours before the event, closes 48 hours after it; notes stay open 90 days) and the qualifier labels.',
  security: portalSecurity,
  responses: { 200: json(LeadSetup, 'The lead setup'), ...problems },
});

const listLeads = createRoute({
  method: 'get',
  path: '/portal/leads',
  operationId: 'listLeads',
  tags: ['portal'],
  summary: 'The leads the rep may see',
  description:
    'The exhibitor admin sees every lead of their exhibitor; staff see their own, or the team’s when the admin shares them. Each lead carries only the fields the attendee agreed to share (P5-8): name, job title and company, and the email only with consent. Another exhibitor’s leads never appear. `409 invalid_state` once lead access has ended (90 days after the event).',
  security: portalSecurity,
  responses: { 200: json(LeadList, 'The leads'), 409: writeProblems[409], ...problems },
});

const ScanBody = z
  .object({
    scanId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,80}$/)
      .openapi({ description: 'The device’s id for this scan: sending it again is a no-op.' }),
    code: z.string().min(1).max(400).openapi({ description: 'The badge QR payload.' }),
    capturedAt: iso.openapi({ description: 'When the scan was made (the device clock).' }),
    offline: z.boolean().optional(),
    rating: LeadRating.nullable().optional(),
    qualifiers: z.array(z.string().max(QUALIFIER_MAX)).max(MAX_QUALIFIERS).optional(),
    notes: z.string().max(NOTES_MAX).optional(),
  })
  .openapi('LeadScan');
const ScanBatchBody = z
  .object({ scans: z.array(ScanBody).min(1).max(SYNC_BATCH_MAX) })
  .openapi('LeadScanBatch');

const ScanResult = z
  .object({
    scanId: z.string(),
    status: LeadScanStatus,
    reason: LeadScanRefusal.nullable(),
    lead: Lead.nullable(),
  })
  .openapi('LeadScanResult');
const ScanBatchResult = z.object({ results: z.array(ScanResult) }).openapi('LeadScanBatchResult');

const syncScans = createRoute({
  method: 'post',
  path: '/portal/leads/scans',
  operationId: 'syncLeadScans',
  tags: ['portal'],
  summary: 'Capture leads: one scan online, or the offline queue in batches',
  description:
    'Each scan id is applied once, so the app can resend its queue until it gets an answer; a scan is checked against the capture window at its own time. A rep without a licence within the allowance gets `403 forbidden` (`reason: no_license` or `over_allowance`); unaccepted lead terms `409` (`terms_not_accepted`).',
  security: portalSecurity,
  request: body(ScanBatchBody),
  responses: { 200: json(ScanBatchResult, 'Results per scan'), ...writeProblems },
});

const LeadParams = z.object({
  leadId: z.uuid().openapi({ param: { name: 'leadId', in: 'path' }, description: 'The lead' }),
});
const LeadPatch = z
  .object({
    rating: LeadRating.nullable(),
    qualifiers: z.array(z.string().max(QUALIFIER_MAX)).max(MAX_QUALIFIERS),
    notes: z.string().max(NOTES_MAX),
  })
  .openapi('LeadUpdate');
const LeadUpdated = z.object({ leadId: z.uuid(), exhibitorId: z.uuid() }).openapi('LeadUpdated');

const patchLead = createRoute({
  method: 'patch',
  path: '/portal/leads/{leadId}',
  operationId: 'updateLead',
  tags: ['portal'],
  summary: 'Rate, qualify and annotate a lead',
  description:
    'Sets the lead’s rating, qualifiers and notes (until lead access ends). A lead of another exhibitor, or a teammate’s that is not shared, is `404` the same as an unknown one.',
  security: portalSecurity,
  request: { params: LeadParams, ...body(LeadPatch) },
  responses: { 200: json(LeadUpdated, 'Updated'), ...writeProblems },
});

/** The bearer portal credential (`yyp_…`): the principal is re-read from the session on every call. */
const authenticate = createMiddleware<Env>(async (c, next) => {
  const m = /^Bearer\s+(yyp_\S+)$/.exec(c.req.header('authorization') ?? '');
  const principal = m?.[1] ? await portalPrincipalByBearer(m[1]) : null;
  if (principal?.subjectKind !== 'exhibitor')
    throw new DomainError('unauthenticated', 'Sign in with your exhibitor invitation');
  c.set('portal', principal);
  await next();
});

const pair = (t: PortalBearerTokens, now = Date.now()) =>
  toWire(PortalTokenPair, {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    tokenType: 'bearer',
    expiresIn: Math.max(1, Math.floor((t.expiresAt.getTime() - now) / 1000)),
    expiresAt: t.expiresAt,
    refreshExpiresAt: t.refreshExpiresAt,
  });

export function portalRoutes(deps: V1Deps, ipOf: (h: Headers) => string) {
  const { ports } = deps;
  const mail = deps.portalMail ?? portalMailer;
  const limits = (h: Headers): PortalLimits => ({
    limiter: deps.portalLimiter ?? platformLimiter(),
    subject: { device: null, ip: ipOf(h) },
  });
  const origin = (url: string) => deps.publicOrigin ?? new URL(url).origin;
  const portal = new OpenAPIHono<Env>();
  portal.use('/portal/leads', authenticate);
  portal.use('/portal/leads/*', authenticate);
  const ctxOf = (c: { get(k: 'portal'): PortalPrincipal; req: { raw: Request } }) =>
    portalCtx(c.get('portal'), localeOf(c.req.raw.headers));
  // Outcomes of a verification the person can act on, as problem+json with a stable reason.
  const refused = (reason: string, extra: Record<string, unknown> = {}) =>
    new DomainError('unauthenticated', 'The code cannot be used', { reason, ...extra });

  return portal
    .openapi(requestCode, async (c) => {
      const locale = localeOf(c.req.raw.headers);
      const r = await requestPortalChallenge(
        // The magic link only works in the browser that asked, so an app has none to offer: the
        // state is random and the email's link falls back to the web page, which asks for the code.
        {
          inviteToken: c.req.valid('json').inviteToken,
          browserState: crypto.randomUUID().replaceAll('-', '').padEnd(43, 'x'),
        },
        limits(c.req.raw.headers),
      );
      if (r.status === 'refused') throw new DomainError('forbidden', 'This invitation cannot be used');
      if (r.status === 'rate_limited')
        throw new DomainError('rate_limited', 'Too many attempts', {
          retryAfter: retryAfterSeconds(r.retryAfterMs),
        });
      if (r.status === 'cooldown')
        return c.json(
          toWire(CodeRequested, { status: 'cooldown', challengeId: r.challengeId, resendAt: r.resendAt }),
          200,
        );
      const prefix = locale === 'en' ? '' : `/${locale}`;
      await mail({
        kind: 'portal.sign-in',
        to: r.email,
        locale,
        orgId: null,
        params: {
          code: r.code,
          url: `${origin(c.req.url)}${prefix}/event-portal/verify/${r.linkToken}`,
          minutes: PORTAL_CODE_TTL_MS / 60_000,
          linkMinutes: PORTAL_LINK_TTL_MS / 60_000,
          eventName: r.eventName,
        },
      });
      return c.json(
        toWire(CodeRequested, { status: 'sent', challengeId: r.challengeId, resendAt: r.resendAt }),
        200,
      );
    })
    .openapi(issuePortalToken, async (c) => {
      const req = c.req.valid('json');
      if (req.grantType === 'refresh_token') {
        const r = await refreshPortalBearerSession(req.refreshToken);
        if (!r.ok)
          throw new DomainError('unauthenticated', 'The refresh token cannot be used', {
            reason: r.reason === 'reused' ? 'refresh_token_reused' : `refresh_token_${r.reason}`,
          });
        return c.json(pair(r.tokens), 200);
      }
      const v = await verifyPortalChallenge(
        { inviteToken: req.inviteToken, challengeId: req.challengeId, code: req.code.replace(/\s/g, '') },
        limits(c.req.raw.headers),
      );
      if (v.status === 'rate_limited')
        throw new DomainError('rate_limited', 'Too many attempts', {
          retryAfter: retryAfterSeconds(v.retryAfterMs),
        });
      if (v.status === 'refused') throw new DomainError('forbidden', 'This invitation cannot be used');
      if (v.status === 'wrong') throw refused('wrong_code', { attemptsLeft: v.attemptsLeft });
      if (v.status !== 'ok') throw refused(`code_${v.status}`);
      return c.json(pair(await createPortalBearerSession({ orgId: v.orgId, accountId: v.accountId })), 200);
    })
    .openapi(revokePortalToken, async (c) => {
      await endPortalBearerSession(c.req.valid('json').refreshToken);
      return c.body(null, 204);
    })
    .openapi(resendInvitations, async (c) => {
      const { siteToken, email } = c.req.valid('json');
      const locale = localeOf(c.req.raw.headers);
      const r = await resendPortalInvitations(
        { siteToken, email: email.trim().toLowerCase(), appOrigin: origin(c.req.url), locale },
        limits(c.req.raw.headers),
      );
      if (r.status === 'refused') throw new DomainError('forbidden', 'This sign-in page cannot be used');
      if (r.status === 'rate_limited')
        throw new DomainError('rate_limited', 'Too many attempts', {
          retryAfter: retryAfterSeconds(r.retryAfterMs),
        });
      for (const i of r.invites)
        await mail({
          kind: 'portal.invite',
          to: i.email,
          locale,
          orgId: r.orgId,
          params: { url: i.url, eventName: i.eventName, role: i.role },
        });
      return c.body(null, 204);
    })
    .openapi(getSetup, async (c) => {
      const setup = await executeQuery(leadSetupQuery, {}, ctxOf(c), ports);
      return c.json(toWire(LeadSetup, setup), 200);
    })
    .openapi(listLeads, async (c) => {
      const setup = await executeQuery(leadSetupQuery, {}, ctxOf(c), ports);
      if (!setup.capture.accessOpen)
        throw new DomainError('invalid_state', 'Lead access has ended', { reason: 'access_ended' });
      const list = await executeQuery(myLeadsQuery, {}, ctxOf(c), ports);
      return c.json(toWire(LeadList, list), 200);
    })
    .openapi(syncScans, async (c) => {
      const out = await executeCommand(syncLeadScansCommand, c.req.valid('json') as never, ctxOf(c), ports);
      return c.json(toWire(ScanBatchResult, out), 200);
    })
    .openapi(patchLead, async (c) => {
      const out = await executeCommand(
        updateLeadCommand,
        { leadId: c.req.valid('param').leadId, ...c.req.valid('json') } as never,
        ctxOf(c),
        ports,
      );
      return c.json(toWire(LeadUpdated, out), 200);
    });
}
