import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ProblemDto } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { createMiddleware } from 'hono/factory';
import {
  deviceContext,
  deviceManifestQuery,
  heartbeatCommand,
  ManifestPageDto,
  SyncResultDto,
  syncScansCommand,
} from './devices.ts';
import { scanTicketCommand } from './scan.ts';
import { SCAN_RESULTS } from './schema.ts';

type Env = { Variables: { device: Ctx } };

const security = [{ deviceToken: [] }];
const problems = {
  401: {
    description: 'Missing or unknown device token',
    content: { 'application/problem+json': { schema: ProblemDto } },
  },
  404: { description: 'Not found', content: { 'application/problem+json': { schema: ProblemDto } } },
};

const manifest = createRoute({
  method: 'get',
  path: '/events/{eventId}/manifest',
  operationId: 'getScannerManifest',
  tags: ['scanner'],
  summary: 'Offline manifest page for a scanner device',
  description:
    'One page of the offline manifest a paired scanner device keeps (ticket rows by short code). Device token only.',
  security,
  request: {
    params: z.object({ eventId: z.uuid().openapi({ description: 'The event the device scans for' }) }),
    query: z.object({
      cursor: z
        .string()
        .max(100)
        .optional()
        .openapi({ description: 'The previous page’s `cursor` (sync position); omit for the start.' }),
      overlap: z
        .enum(['true', 'false'])
        .openapi('ManifestOverlap')
        .optional()
        .openapi({ description: '`true` re-reads the last page’s rows as well (after a crash mid-page).' }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .openapi({ description: 'Rows per page (1–2000).' }),
    }),
  },
  responses: {
    200: { description: 'Manifest page', content: { 'application/json': { schema: ManifestPageDto } } },
    403: {
      description: 'The device is handed to a member with no role at this event',
      content: { 'application/problem+json': { schema: ProblemDto } },
    },
    ...problems,
  },
});

const ScanBatchBody = z.object({
  eventId: z.uuid(),
  scans: z
    .array(
      z.object({
        scanId: z.uuid(),
        code: z.string().min(1).max(400),
        deviceTs: z.iso.datetime(),
        clockOffsetMs: z.int(),
        verdict: z.string(),
        checkpointId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const batch = createRoute({
  method: 'post',
  path: '/scans/batch',
  operationId: 'syncScans',
  tags: ['scanner'],
  summary: 'Sync up to 500 offline scans (idempotent by scanId)',
  description:
    'Uploads scans made offline; each is applied once by its `scanId`, so a retry is safe. Device token only.',
  security,
  request: { body: { content: { 'application/json': { schema: ScanBatchBody } }, required: true } },
  responses: {
    200: {
      description: 'Server results per scan',
      content: { 'application/json': { schema: SyncResultDto } },
    },
    ...problems,
  },
});

const HeartbeatBody = z.object({
  batteryPct: z.int().min(0).max(100).nullable().optional(),
  queueDepth: z.int().min(0),
  clockOffsetMs: z.int(),
  eventId: z.uuid().optional().openapi({ description: 'The event the device is working (device board).' }),
  checkpointId: z
    .uuid()
    .nullable()
    .optional()
    .openapi({ description: 'Where the device scans; null for the whole event.' }),
  appVersion: z
    .string()
    .regex(/^[A-Za-z0-9._+-]{1,64}$/)
    .optional()
    .openapi({ description: 'The scanner app build, shown on the device board.' }),
});
const HeartbeatResponse = z.object({
  serverTime: z.iso.datetime(),
  commands: z.array(z.enum(['wipe'])),
  syncRequestedAt: z.iso
    .datetime()
    .nullable()
    .optional()
    .openapi({ description: 'A supervisor asked for a sync at this time; sync if not done since.' }),
  checkpoint: z
    .object({ id: z.uuid().nullable(), requestedAt: z.iso.datetime() })
    .nullable()
    .optional()
    .openapi({ description: 'A supervisor moved the device to this checkpoint (null: the whole event).' }),
  kiosk: z
    .object({
      eventId: z.uuid(),
      checkpointId: z.uuid().nullable(),
      pinHash: z.string(),
      startedAt: z.iso.datetime(),
    })
    .nullable()
    .optional()
    .openapi({
      description: 'Kiosk mode: self check-in locked to this event and entrance; PIN (PBKDF2) to exit.',
    }),
});

const heartbeat = createRoute({
  method: 'post',
  path: '/devices/heartbeat',
  operationId: 'deviceHeartbeat',
  tags: ['scanner'],
  summary: 'Device health every 30 s; returns pending commands (wipe, sync, checkpoint, kiosk)',
  description:
    'Reports the device’s health about every 30 seconds and returns pending commands such as `wipe`. Device token only.',
  security,
  request: { body: { content: { 'application/json': { schema: HeartbeatBody } }, required: true } },
  responses: {
    200: {
      description: 'Server time and commands',
      content: { 'application/json': { schema: HeartbeatResponse } },
    },
    ...problems,
  },
});

const CheckinBody = z.object({
  eventId: z.uuid(),
  code: z.string().min(1).max(400),
  checkpointId: z.uuid().optional(),
});
/** The door verdict (a named /v1 schema; `@yayatoh/api-v1` reuses it). */
export const ScanResult = z.enum(SCAN_RESULTS).openapi('ScanResult');

const CheckinVerdict = z.object({
  result: ScanResult,
  ticket: z
    .object({
      holderName: z.string().nullable(),
      typeName: z.string(),
      serial: z.int(),
      shortCode: z.string(),
    })
    .nullable(),
  admissionId: z.uuid().nullable(),
  firstAdmittedAt: z.iso.datetime({ offset: true }).nullable(),
});

const checkin = createRoute({
  method: 'post',
  path: '/checkins',
  operationId: 'checkInWithDevice',
  tags: ['scanner'],
  summary: 'Scan one ticket online and get the door verdict',
  description: 'Retrying with the same Idempotency-Key returns the first verdict instead of a duplicate.',
  security,
  request: {
    headers: z.object({
      'idempotency-key': z
        .string()
        .regex(/^[\x21-\x7e]{8,80}$/)
        .openapi({ description: 'Required. A retry with the same key returns the first verdict.' }),
    }),
    body: { content: { 'application/json': { schema: CheckinBody } }, required: true },
  },
  responses: {
    200: { description: 'The verdict', content: { 'application/json': { schema: CheckinVerdict } } },
    ...problems,
  },
});

/**
 * Scanner endpoints (roadmap §6.1) as a router any host can mount: `apps/api` at `/v1`, and the
 * web app at `/api/v1` so the Scan PWA calls its own origin. Errors are thrown as DomainErrors;
 * the host turns them into problem+json.
 */
export function scannerRoutes(ports: CommandPorts<TenantTx>) {
  const scanner = new OpenAPIHono<Env>({
    defaultHook: (result) => {
      if (!result.success) throw new DomainError('validation_failed', 'Invalid request');
    },
  });
  // Device bearer token → device context. The org comes from the token, never from a header.
  const authenticate = createMiddleware<Env>(async (c, next) => {
    const m = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
    const dc = m?.[1] ? await deviceContext(m[1]) : null;
    if (!dc) throw new DomainError('unauthenticated', 'Device token required');
    c.set('device', dc.ctx);
    await next();
  });
  scanner.use('/events/*', authenticate);
  scanner.use('/scans/*', authenticate);
  scanner.use('/devices/*', authenticate);
  scanner.use('/checkins', authenticate);

  return scanner
    .openapi(manifest, async (c) => {
      const q = c.req.valid('query');
      const page = await executeQuery(
        deviceManifestQuery,
        {
          eventId: c.req.valid('param').eventId,
          cursor: q.cursor,
          overlap: q.overlap === 'true',
          limit: q.limit,
        },
        c.get('device'),
        ports,
      );
      return c.json(page, 200);
    })
    .openapi(batch, async (c) => {
      const r = await executeCommand(syncScansCommand, c.req.valid('json'), c.get('device'), ports);
      return c.json(r, 200);
    })
    .openapi(heartbeat, async (c) => {
      const r = await executeCommand(heartbeatCommand, c.req.valid('json'), c.get('device'), ports);
      return c.json(
        {
          serverTime: r.serverTime.toISOString(),
          commands: r.commands,
          syncRequestedAt: r.syncRequestedAt?.toISOString() ?? null,
          checkpoint: r.checkpoint
            ? { id: r.checkpoint.id, requestedAt: r.checkpoint.requestedAt.toISOString() }
            : null,
          kiosk: r.kiosk ? { ...r.kiosk, startedAt: r.kiosk.startedAt.toISOString() } : null,
        },
        200,
      );
    })
    .openapi(checkin, async (c) => {
      const v = await executeCommand(
        scanTicketCommand,
        { ...c.req.valid('json'), clientScanId: c.req.valid('header')['idempotency-key'] },
        c.get('device'),
        ports,
      );
      return c.json(
        CheckinVerdict.parse({ ...v, firstAdmittedAt: v.firstAdmittedAt?.toISOString() ?? null }),
        200,
      );
    });
}

/** Register the device bearer scheme on the host's OpenAPI document. */
export const DEVICE_TOKEN_SCHEME = {
  type: 'http',
  scheme: 'bearer',
  description: 'Scanner device token (`yyd_…`), issued once at enrollment.',
} as const;
