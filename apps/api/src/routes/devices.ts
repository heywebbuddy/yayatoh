import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  deviceContext,
  deviceManifestQuery,
  heartbeatCommand,
  ManifestPageDto,
  SyncResultDto,
  syncScansCommand,
} from '@yayatoh/checkin';
import { ProblemDto } from '@yayatoh/contracts';
import { type Ctx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { createMiddleware } from 'hono/factory';
import { ports } from '../ports.ts';

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
  tags: ['scanner'],
  summary: 'Offline manifest page for a scanner device',
  security,
  request: {
    params: z.object({ eventId: z.uuid() }),
    query: z.object({
      cursor: z.string().max(100).optional(),
      overlap: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(2000).optional(),
    }),
  },
  responses: {
    200: { description: 'Manifest page', content: { 'application/json': { schema: ManifestPageDto } } },
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
      }),
    )
    .min(1)
    .max(500),
});

const batch = createRoute({
  method: 'post',
  path: '/scans/batch',
  tags: ['scanner'],
  summary: 'Sync up to 500 offline scans (idempotent by scanId)',
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
});
const HeartbeatResponse = z.object({ serverTime: z.iso.datetime(), commands: z.array(z.enum(['wipe'])) });

const heartbeat = createRoute({
  method: 'post',
  path: '/devices/heartbeat',
  tags: ['scanner'],
  summary: 'Device health every 30 s; returns pending commands (wipe)',
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

export const scanner = new OpenAPIHono<Env>();

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

scanner
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
    const body = c.req.valid('json');
    const r = await executeCommand(syncScansCommand, body, c.get('device'), ports);
    return c.json(r, 200);
  })
  .openapi(heartbeat, async (c) => {
    const r = await executeCommand(heartbeatCommand, c.req.valid('json'), c.get('device'), ports);
    return c.json({ serverTime: r.serverTime.toISOString(), commands: r.commands }, 200);
  });
