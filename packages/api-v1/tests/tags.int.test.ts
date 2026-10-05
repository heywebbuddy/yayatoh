import { randomBytes } from 'node:crypto';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, setEventDetailsCommand } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';

const app = new Hono();
const payments = fakePaymentProvider({
  secret: randomBytes(32).toString('hex'),
  appOrigin: 'http://localhost:3000',
});
app.route('/v1', createV1({ ports, payments: () => payments, telemetry: false }));

type Json = Record<string, unknown>;
async function get(path: string, key: string) {
  const res = await app.request(`/v1${path}`, { headers: { authorization: `Bearer ${key}` } });
  return { status: res.status, body: (await res.json()) as Json };
}

let a: OrgFixture;
let b: OrgFixture;
let taggedId: string;
const marker = `Api${randomBytes(3).toString('hex')}`;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Tagged API', timezone: 'UTC', startsAt: '2030-05-01T18:00:00Z', endsAt: '2030-05-01T22:00:00Z' },
    a.ctx(),
    ports,
  );
  taggedId = e.id;
  await executeCommand(
    setEventDetailsCommand,
    { eventId: e.id, tags: [marker, 'Outdoor'], category: 'music' },
    a.ctx(),
    ports,
  );
});
afterAll(closePools);

describe('/v1 event tags (U8, additive)', () => {
  it('every event carries its tags and category; `tag` filters the list case-insensitively', async () => {
    const one = await get(`/orgs/${a.org.slug}/events/${taggedId}`, a.apiKey);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: taggedId, category: 'music' });
    expect(one.body.tags).toEqual(expect.arrayContaining([marker, 'Outdoor']));

    const all = await get(`/orgs/${a.org.slug}/events?limit=100`, a.apiKey);
    expect(all.status).toBe(200);
    for (const e of all.body.data as Json[]) expect(Array.isArray(e.tags)).toBe(true);

    const filtered = await get(`/orgs/${a.org.slug}/events?tag=${marker.toUpperCase()}`, a.apiKey);
    expect(filtered.status).toBe(200);
    expect((filtered.body.data as Json[]).map((e) => e.id)).toEqual([taggedId]);
    expect(filtered.body.nextCursor).toBeNull();

    // Too long a tag is a validation problem, not an empty page.
    expect((await get(`/orgs/${a.org.slug}/events?tag=${'x'.repeat(41)}`, a.apiKey)).status).toBe(400);
  });

  it('tags never leak across orgs', async () => {
    const other = await get(`/orgs/${b.org.slug}/events?tag=${marker}`, b.apiKey);
    expect(other.status).toBe(200);
    expect(other.body.data).toEqual([]);
    for (const e of (await get(`/orgs/${b.org.slug}/events?limit=100`, b.apiKey)).body.data as Json[])
      expect(e.tags).not.toContain(marker);
    // A's event through B's key is a 404.
    expect((await get(`/orgs/${b.org.slug}/events/${taggedId}`, b.apiKey)).status).toBe(404);
  });
});
