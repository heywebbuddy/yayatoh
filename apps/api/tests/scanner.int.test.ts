import { enrollDeviceCommand } from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, uuidv7 } from '@yayatoh/kernel';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

const app = createApp();
let a: OrgFixture;
let b: OrgFixture;
let token: string;
let bToken: string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  token = (await executeCommand(enrollDeviceCommand, { label: 'Gate 1' }, a.ctx(), ports)).token;
  bToken = (await executeCommand(enrollDeviceCommand, { label: 'Bravo gate' }, b.ctx(), ports)).token;
});
afterAll(closePools);

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('/v1 scanner endpoints', () => {
  it('require a device token (problem+json 401), whatever org header is sent', async () => {
    const res = await app.request(`/v1/events/${a.event.id}/manifest`, {
      headers: { 'yayatoh-org': a.org.id },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(((await res.json()) as { code: string }).code).toBe('unauthenticated');
  });

  it('serve the manifest of the device’s own org, without emails', async () => {
    const res = await app.request(`/v1/events/${a.event.id}/manifest?limit=50`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; complete: boolean; header: { salt: string } };
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.complete).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/@alpha|\.test"/);
    // Another org's device cannot read this event (the org comes from its own token).
    const other = await app.request(`/v1/events/${a.event.id}/manifest`, { headers: auth(bToken) });
    expect(other.status).toBe(404);
  });

  it('sync a batch idempotently and take heartbeats', async () => {
    const scan = {
      scanId: uuidv7(),
      code: 'NOTACODE',
      deviceTs: new Date().toISOString(),
      clockOffsetMs: 0,
      verdict: 'invalid',
    };
    const post = () =>
      app.request('/v1/scans/batch', {
        method: 'POST',
        headers: { ...auth(token), 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: a.event.id, scans: [scan] }),
      });
    const first = (await (await post()).json()) as { results: { result: string; stored: boolean }[] };
    // An invalid code describes no ticket, so it has no open signals (M1.9e, additive field).
    expect(first.results).toEqual([{ scanId: scan.scanId, result: 'invalid', stored: true, openSignals: 0 }]);
    const again = (await (await post()).json()) as { results: { stored: boolean }[] };
    expect(again.results[0]?.stored).toBe(false);

    const hb = await app.request('/v1/devices/heartbeat', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ batteryPct: 50, queueDepth: 0, clockOffsetMs: 12 }),
    });
    expect(hb.status).toBe(200);
    expect(await hb.json()).toMatchObject({ commands: [] });
  });
});
