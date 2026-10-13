import { enrollDeviceCommand } from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand } from '@yayatoh/kernel';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

/**
 * M7.2d (decision P7-9): the minimum-version gate. An app below its minimum gets a 426 with the
 * store link; a request without the app header never does; a Staff device never does while its
 * event is on (24 h before the start to 2 h after the end).
 */

const STORE = 'https://apps.example.test/yayatoh';
const STAFF_STORE = 'https://apps.example.test/yayatoh-staff';
let now = new Date();
const app = createApp({
  now: () => now,
  mobile: {
    minimumVersions: { ios: '3.0.0', android: '3.0.0' },
    latestVersions: { ios: '3.4.0', android: '3.4.0' },
    apps: {
      'yayatoh-ios': { storeUrl: STORE },
      'yayatoh-android': { storeUrl: STORE },
      'yayatoh-staff-ios': { minimumVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: STAFF_STORE },
      'yayatoh-staff-android': { minimumVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: STAFF_STORE },
    },
  },
});

let a: OrgFixture;
let token: string;
let starts: Date;
let ends: Date;

beforeAll(async () => {
  ({ a } = await twoOrgs());
  token = (await executeCommand(enrollDeviceCommand, { label: 'Gate 9' }, a.ctx(), ports)).token;
  starts = new Date(a.event.startsAt);
  ends = new Date(a.event.endsAt);
});
afterAll(closePools);

const H = 3_600_000;
const client = (c: string) => ({ 'x-yayatoh-client': c });
const device = () => ({ authorization: `Bearer ${token}` });
const heartbeat = (headers: Record<string, string>) =>
  app.request('/v1/devices/heartbeat', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ queueDepth: 0, clockOffsetMs: 0 }),
  });

describe('/v1/mobile/config', () => {
  it('keeps the old fields and adds the per-app policy', async () => {
    const res = await app.request('/v1/mobile/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      minimumVersions: { ios: '3.0.0', android: '3.0.0' },
      latestVersions: { ios: '3.4.0', android: '3.4.0' },
      baseUrls: { api: expect.any(String), web: expect.any(String) },
      features: expect.any(Object),
      apps: {
        // The attendee apps inherit the per-platform values; the Staff apps have their own.
        'yayatoh-ios': { minimumVersion: '3.0.0', latestVersion: '3.4.0', storeUrl: STORE },
        'yayatoh-android': { minimumVersion: '3.0.0', latestVersion: '3.4.0', storeUrl: STORE },
        'yayatoh-staff-ios': { minimumVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: STAFF_STORE },
        'yayatoh-staff-android': { minimumVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: STAFF_STORE },
      },
    });
  });

  it('always answers, even to an app below its minimum', async () => {
    const res = await app.request('/v1/mobile/config', { headers: client('yayatoh-ios/1.0.0 (7)') });
    expect(res.status).toBe(200);
  });
});

describe('a below-minimum attendee app', () => {
  it('gets 426 problem+json with the store link', async () => {
    const res = await app.request('/v1/public/events/anything', {
      headers: client('yayatoh-ios/2.9.9 (120)'),
    });
    expect(res.status).toBe(426);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      type: 'https://docs.yayatoh.com/problems/upgrade_required',
      status: 426,
      code: 'upgrade_required',
      details: {
        client: 'yayatoh-ios',
        version: '2.9.9',
        minimumVersion: '3.0.0',
        latestVersion: '3.4.0',
        storeUrl: STORE,
      },
    });
  });

  it('is refused on authenticated routes before the credential is even looked at', async () => {
    const res = await app.request('/v1/me', {
      headers: { ...client('yayatoh-android/2.0.0'), authorization: 'Bearer not-a-session' },
    });
    expect(res.status).toBe(426);
  });

  it('compares versions numerically, not as text', async () => {
    const ok = (v: string) =>
      app.request('/v1/health', { headers: client(`yayatoh-ios/${v}`) }).then((r) => r.status);
    expect(await ok('3.0.0')).toBe(200);
    expect(await ok('3.10.0 (2)')).toBe(200);
    expect(await ok('10.0.0')).toBe(200);
    expect(await ok('3.0.0-beta.1')).toBe(200);
    // /v1/health is on the always-answers list; use a data route to see the gate.
    const gated = (v: string) =>
      app
        .request('/v1/public/events/anything', { headers: client(`yayatoh-ios/${v}`) })
        .then((r) => r.status);
    expect(await gated('3.0.0')).not.toBe(426);
    expect(await gated('3.10.0 (2)')).not.toBe(426);
    expect(await gated('10.0.0')).not.toBe(426);
    expect(await gated('2.99.99')).toBe(426);
    expect(await gated('3')).not.toBe(426);
    expect(await gated('2')).toBe(426);
  });

  it('answers the health check and the API document (a stale app can still see what to do)', async () => {
    const h = client('yayatoh-ios/1.0.0');
    expect((await app.request('/v1/health', { headers: h })).status).toBe(200);
    expect((await app.request('/v1/openapi.json', { headers: h })).status).toBe(200);
  });
});

describe('requests that are never refused', () => {
  it('without the header, with a malformed one, or from an unknown or non-app client', async () => {
    const status = (headers: Record<string, string>) =>
      app.request('/v1/public/events/anything', { headers }).then((r) => r.status);
    expect(await status({})).not.toBe(426);
    for (const h of [
      'yayatoh-ios',
      'yayatoh-ios/',
      'yayatoh-ios/banana',
      '/1.0.0',
      'someone-else/0.0.1',
      'web/0.0.1',
      'scan-pwa/0.0.1',
      'sdk-ts/0.0.1',
      'ios/1.0.0',
      'x'.repeat(500),
    ])
      expect(await status(client(h))).not.toBe(426);
    expect(
      await status({ 'x-app-version': '0.0.1', 'user-agent': 'Yayatoh/0.0.1 CFNetwork Darwin' }),
    ).not.toBe(426);
  });
});

describe('a below-minimum Staff app', () => {
  const old = client('yayatoh-staff-ios/1.0.0 (3)');

  it('gets 426 on a user route, like any app', async () => {
    const res = await app.request('/v1/public/events/anything', { headers: old });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ details: { storeUrl: STAFF_STORE, minimumVersion: '2.0.0' } });
  });

  it('with a device token gets no 426 from 24 h before its event starts until 2 h after it ends', async () => {
    for (const at of [
      new Date(starts.getTime() - 24 * H + 60_000),
      starts,
      new Date((starts.getTime() + ends.getTime()) / 2),
      ends,
      new Date(ends.getTime() + 2 * H - 60_000),
    ]) {
      now = at;
      const res = await heartbeat({ ...device(), ...old });
      expect(res.status, at.toISOString()).toBe(200);
    }
  });

  it('with a device token gets the 426 outside the window', async () => {
    for (const at of [
      new Date(starts.getTime() - 24 * H - 60_000),
      new Date(ends.getTime() + 2 * H + 60_000),
      new Date(starts.getTime() - 400 * 24 * H),
    ]) {
      now = at;
      const res = await heartbeat({ ...device(), ...old });
      expect(res.status, at.toISOString()).toBe(426);
    }
  });

  it('is judged by the event in the manifest path, so a fresh device is not stranded', async () => {
    now = new Date(starts.getTime() + H);
    const res = await app.request(`/v1/events/${a.event.id}/manifest?limit=5`, {
      headers: { ...device(), ...old },
    });
    expect(res.status).toBe(200);
    now = new Date(ends.getTime() + 3 * H);
    const after = await app.request(`/v1/events/${a.event.id}/manifest?limit=5`, {
      headers: { ...device(), ...old },
    });
    expect(after.status).toBe(426);
  });

  it('leaves a token that is not a live device to its own 401', async () => {
    now = new Date(starts.getTime() - 400 * 24 * H);
    const fake = `yyd_${'A'.repeat(43)}`;
    const res = await heartbeat({ authorization: `Bearer ${fake}`, ...old });
    expect(res.status).toBe(401);
  });

  it('does not shield an attendee app that happens to carry a device token', async () => {
    now = new Date(starts.getTime() + H);
    const res = await heartbeat({ ...device(), ...client('yayatoh-ios/1.0.0') });
    // The gate lets a live device through inside its window whichever app sends it; the
    // attendee apps never hold device tokens, so this is not a way around the minimum for users.
    expect(res.status).toBe(200);
    const user = await app.request('/v1/me', {
      headers: { ...client('yayatoh-ios/1.0.0'), authorization: 'Bearer some-session' },
    });
    expect(user.status).toBe(426);
  });
});
