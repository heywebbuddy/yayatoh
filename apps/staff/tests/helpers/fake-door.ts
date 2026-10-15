/**
 * A fake `/v1` for the door device's tests: the staff overview (the enrolment proof), the manifest
 * header (the event's dates and places) and the heartbeat, answered the way the server does
 * (problem+json for refusals). Records every call so tests can check what was sent and where.
 */
export const EVENT_ID = '0192f6f0-0000-7000-8000-00000000e001';
export const DEVICE_ID = '0192f6f0-0000-7000-8000-00000000d001';
export const TOKEN = `yyd_${'A1b2C3d4E5'.repeat(4)}abc`;
export const OTHER_TOKEN = `yyd_${'Z9y8X7w6V5'.repeat(4)}xyz`;
export const CHECKPOINTS = [
  { id: '0192f6f0-0000-7000-8000-0000000c0001', name: 'Main door', kind: 'door' },
  { id: '0192f6f0-0000-7000-8000-0000000c0002', name: 'VIP lane', kind: 'door' },
];

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const problem = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type: `https://x/${code}`, title: code, status, code, details }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

export interface FakeDoor {
  fetch: typeof globalThis.fetch;
  calls: {
    method: string;
    url: string;
    authorization: string | null;
    client: string | null;
    body: unknown;
  }[];
  /** Tokens the server accepts. */
  valid: Set<string>;
  /** Tokens whose device a supervisor asked to wipe (the heartbeat says so, every other route 401s). */
  wiping: Set<string>;
  serverTimeOffsetMs: number;
  startsAt: string;
  endsAt: string;
  /** What the next heartbeat answers besides the commands. */
  heartbeatExtras: Record<string, unknown>;
  failNetwork: boolean;
  overviewStatus?: number;
  /** Respond 426 to everything but the config route. */
  upgradeRequired: boolean;
  now: () => number;
}

export function createFakeDoor(now: () => number = Date.now): FakeDoor {
  const door: FakeDoor = {
    calls: [],
    valid: new Set([TOKEN]),
    wiping: new Set(),
    serverTimeOffsetMs: 0,
    startsAt: new Date(now() + 3_600_000).toISOString(),
    endsAt: new Date(now() + 8 * 3_600_000).toISOString(),
    heartbeatExtras: {},
    failNetwork: false,
    upgradeRequired: false,
    now,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (door.failNetwork) throw new TypeError('Network request failed');
      const url = new URL(request.url);
      const text = await request.clone().text();
      door.calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get('authorization'),
        client: request.headers.get('x-yayatoh-client'),
        body: text ? JSON.parse(text) : null,
      });
      if (door.upgradeRequired)
        return problem(426, 'upgrade_required', {
          minimumVersion: '9.0.0',
          latestVersion: '9.1.0',
          storeUrl: 'https://store.example/staff',
        });
      const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      const known = token !== undefined && door.valid.has(token);
      const wiping = token !== undefined && door.wiping.has(token);
      if (url.pathname.endsWith('/devices/heartbeat')) {
        if (!known) return problem(401, 'unauthenticated');
        return json(200, {
          serverTime: new Date(door.now() + door.serverTimeOffsetMs).toISOString(),
          commands: wiping ? ['wipe'] : [],
          ...door.heartbeatExtras,
        });
      }
      if (!known || wiping) return problem(401, 'unauthenticated');
      if (url.pathname.endsWith('/overview')) {
        if (door.overviewStatus) return problem(door.overviewStatus, 'not_found');
        return json(200, { eventId: EVENT_ID, eventName: 'Summit', deviceId: DEVICE_ID });
      }
      if (url.pathname.endsWith('/manifest'))
        return json(200, {
          header: {
            event: {
              id: EVENT_ID,
              name: 'Summit',
              startsAt: door.startsAt,
              endsAt: door.endsAt,
              timezone: 'Europe/Lisbon',
            },
            publicKeys: {},
            salt: 's',
            serverTime: new Date(door.now()).toISOString(),
            unknownPolicy: 'provisional',
            checkpoints: CHECKPOINTS.map((c) => ({ ...c, ticketTypeIds: [] })),
          },
          rows: [],
          cursor: null,
        });
      return problem(404, 'not_found');
    },
  };
  return door;
}

/** `https://app.yayatoh.com/scan#e=<event>&k=<token>`, the link an enrolment QR holds. */
export const enrolLink = (token = TOKEN, eventId = EVENT_ID, host = 'app.yayatoh.com') =>
  `https://${host}/scan#e=${eventId}&k=${encodeURIComponent(token)}`;
