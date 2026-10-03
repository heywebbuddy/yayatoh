import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake Yayatoh /v1 for the Zapier app's tests (M6.4c): the routes the app calls, in memory, on
 * a local port. It answers like the real API (bearer keys bound to one org with scopes,
 * Idempotency-Key on writes, problem+json errors, the same resource shapes; `contract.test.ts`
 * checks the shapes against `apps/api/openapi.json`, and `zapier-v1.int.test.ts` runs the same app
 * against the real /v1). No network beyond 127.0.0.1.
 */

export interface FakeKey {
  readonly org: string;
  readonly scopes: readonly string[];
  readonly name?: string;
}

export interface FakeApi {
  readonly url: string;
  readonly keys: Map<string, FakeKey>;
  readonly hooks: Map<string, { org: string; url: string; event: string }>;
  readonly contacts: Map<string, { id: string; email: string; name: string | null }>;
  readonly registrations: { id: string; eventId: string; name: string; email: string; labels: string[] }[];
  readonly admitted: Set<string>;
  /** Every request: method, path and whether it carried an Idempotency-Key. */
  readonly log: { method: string; path: string; idempotencyKey: string | null }[];
  /** The last JSON response per route (for the contract test). */
  readonly responses: Map<string, unknown>;
  close(): Promise<void>;
}

export const FAKE_ORG = 'lakeside-events';
export const FAKE_EVENT_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a82';
export const OTHER_EVENT_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7aff';
export const GOOD_CODE = 'K7Q2-9XZD';
const EVENTS = new Set(['order.paid', 'ticket.admitted', 'form.registration_submitted', 'event.published']);
const AT = '2030-03-01T23:04:11.000Z';

const SAMPLES: Record<string, Record<string, unknown>> = {
  'order.paid': {
    orderId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a81',
    eventId: FAKE_EVENT_ID,
    totalMinor: 5000,
    currency: 'USD',
    via: 'stripe',
  },
  'ticket.admitted': {
    eventId: FAKE_EVENT_ID,
    ticketId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a83',
    admissionId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
    day: '2030-03-01',
    admittedAt: AT,
  },
  'form.registration_submitted': {
    respondentId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
    eventId: FAKE_EVENT_ID,
    registrationTypeId: 'vip',
    formVersion: 3,
  },
  'event.published': { eventId: FAKE_EVENT_ID, from: 'draft', to: 'published' },
};

export const envelope = (type: string, data: Record<string, unknown>) => ({
  id: randomUUID(),
  type,
  version: 1,
  apiVersion: 'v1',
  occurredAt: AT,
  orgId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a7f',
  data,
});

const EVENT = {
  id: FAKE_EVENT_ID,
  slug: 'spring-gala',
  name: 'Spring Gala',
  tagline: null,
  profile: 'gala',
  status: 'published',
  visibility: 'public',
  timezone: 'America/Chicago',
  startsAt: '2030-03-01T23:00:00.000Z',
  endsAt: '2030-03-02T03:00:00.000Z',
  venueName: 'Lakeside Pavilion',
  city: 'Chicago',
  country: 'US',
  currency: 'USD',
  publishedAt: '2030-01-10T15:00:00.000Z',
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function startFakeApi(): Promise<FakeApi> {
  const keys = new Map<string, FakeKey>();
  const hooks = new Map<string, { org: string; url: string; event: string }>();
  const contacts = new Map<string, { id: string; email: string; name: string | null }>();
  const registrations: FakeApi['registrations'] = [];
  const admitted = new Set<string>();
  const log: FakeApi['log'] = [];
  const responses = new Map<string, unknown>();
  const replays = new Map<string, { status: number; body: unknown }>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://fake');
    const method = req.method ?? 'GET';
    const idem = (req.headers['idempotency-key'] as string | undefined) ?? null;
    log.push({ method, path: u.pathname, idempotencyKey: idem });
    const send = (status: number, body: unknown, route?: string) => {
      if (route && status < 300) responses.set(route, body);
      res.writeHead(status, {
        'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      });
      res.end(body === null ? undefined : JSON.stringify(body));
    };
    const problem = (status: number, code: string, title: string) =>
      send(status, { type: `https://docs.yayatoh.com/problems/${code}`, title, status, code });

    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const key = token ? keys.get(token) : undefined;
    if (!key) return problem(401, 'unauthenticated', 'Unknown, expired or revoked API key');
    const m = /^\/v1\/orgs\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m || decodeURIComponent(m[1] ?? '') !== key.org)
      return problem(404, 'not_found', 'Organization not found');
    const path = m[2] ?? '';
    const need = (scope: string) => {
      if (key.scopes.includes(scope)) return true;
      problem(403, 'forbidden', 'The credential lacks the scope or role');
      return false;
    };
    const write = method === 'POST';
    if (write && !idem) return problem(400, 'validation_failed', 'Idempotency-Key is required');
    const replayKey = idem ? `${token}|${method}|${u.pathname}|${idem}` : null;
    if (replayKey && replays.has(replayKey)) {
      const r = replays.get(replayKey);
      return send(r?.status ?? 200, r?.body ?? null);
    }
    const done = (status: number, body: unknown, route: string) => {
      if (replayKey) replays.set(replayKey, { status, body });
      send(status, body, route);
    };
    const body = write ? await readJson(req) : null;

    if (method === 'GET' && path === '/api-key')
      return done(
        200,
        {
          id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7b01',
          name: key.name ?? 'Zapier',
          prefix: token?.slice(0, 12) ?? '',
          scopes: key.scopes,
          test: false,
          sandboxOrg: false,
          createdAt: AT,
          expiresAt: null,
          rotated: false,
          rateLimit: { keyPerMinute: 600, orgPerMinute: 1200 },
        },
        'ApiKeyInfo',
      );
    if (method === 'GET' && path === '/events') {
      if (!need('events:read')) return;
      return done(200, { data: [EVENT], nextCursor: null }, 'EventPage');
    }
    if (method === 'POST' && path === '/hooks') {
      if (!need('webhooks:subscribe')) return;
      const url = typeof body?.url === 'string' ? body.url : '';
      const event = typeof body?.event === 'string' ? body.event : '';
      if (!/^https:\/\/[^/]+\//.test(url) || !EVENTS.has(event))
        return problem(400, 'validation_failed', 'Validation failed');
      const id = randomUUID();
      hooks.set(id, { org: key.org, url, event });
      return done(201, { id, event, createdAt: AT }, 'Hook');
    }
    const hook = /^\/hooks\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'DELETE' && hook) {
      if (!need('webhooks:subscribe')) return;
      hooks.delete(hook[1] ?? '');
      return send(204, null);
    }
    if (method === 'GET' && path === '/hooks/samples') {
      if (!need('webhooks:subscribe')) return;
      const event = u.searchParams.get('event') ?? '';
      const data = SAMPLES[event];
      if (!data) return problem(400, 'validation_failed', 'Validation failed');
      return done(200, { data: [envelope(event, data)] }, 'HookSampleList');
    }
    if (method === 'POST' && path === '/contacts') {
      if (!need('contacts:write')) return;
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email))
        return problem(400, 'validation_failed', 'Validation failed');
      const norm = email.toLowerCase();
      const had = contacts.get(norm);
      const c = had ?? { id: randomUUID(), email, name: typeof body?.name === 'string' ? body.name : null };
      contacts.set(norm, c);
      return done(200, { id: c.id, created: !had }, 'ContactRef');
    }
    const reg = /^\/events\/([0-9a-f-]{36})\/(registrations|checkins)$/.exec(path);
    if (method === 'POST' && reg) {
      const eventId = reg[1] ?? '';
      if (reg[2] === 'registrations') {
        if (!need('attendees:write')) return;
        if (eventId !== FAKE_EVENT_ID) return problem(404, 'not_found', 'Event not found');
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        const email = typeof body?.email === 'string' ? body.email.trim() : '';
        if (!name || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email))
          return problem(400, 'validation_failed', 'Validation failed');
        if (registrations.some((r) => r.eventId === eventId && r.email.toLowerCase() === email.toLowerCase()))
          return problem(409, 'conflict', 'Already on the guest list');
        const labels = Array.isArray(body?.labels) ? (body.labels as string[]) : [];
        const r = { id: randomUUID(), eventId, name, email, labels };
        registrations.push(r);
        return done(
          201,
          { ...r, source: 'guest', status: 'active', ticketId: null, createdAt: AT },
          'Attendee',
        );
      }
      if (!need('checkin:scan')) return;
      if (eventId !== FAKE_EVENT_ID) return problem(404, 'not_found', 'Event not found');
      const code = typeof body?.code === 'string' ? body.code : '';
      if (code !== GOOD_CODE)
        return done(
          200,
          { result: 'invalid', ticket: null, admissionId: null, firstAdmittedAt: null },
          'ScanVerdict',
        );
      const ticket = {
        holderName: 'Ada Lovelace',
        typeName: 'General admission',
        serial: 1,
        shortCode: GOOD_CODE,
      };
      if (admitted.has(code))
        return done(
          200,
          { result: 'duplicate', ticket, admissionId: null, firstAdmittedAt: AT },
          'ScanVerdict',
        );
      admitted.add(code);
      return done(
        200,
        {
          result: 'admitted',
          ticket,
          admissionId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
          firstAdmittedAt: null,
        },
        'ScanVerdict',
      );
    }
    return problem(404, 'not_found', 'Not found');
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    keys,
    hooks,
    contacts,
    registrations,
    admitted,
    log,
    responses,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
