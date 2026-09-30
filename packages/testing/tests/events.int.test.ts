import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  getEventBySlugQuery,
  listEventsQuery,
  publicEventBySlug,
  transitionEventCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const base = {
  timezone: 'America/New_York',
  startsAt: '2027-05-01T23:00:00Z',
  endsAt: '2027-05-02T03:00:00Z',
};
const transition = (eventId: string, t: string, ctx = a.ctx()) =>
  executeCommand(transitionEventCommand, { eventId, transition: t }, ctx, ports);

describe('events', () => {
  it('creates a draft with a slug derived from the name', async () => {
    const e = await executeCommand(
      createEventCommand,
      { ...base, name: `Spring Gala ${a.org.slug}` },
      a.ctx(),
      ports,
    );
    expect(e).toMatchObject({ status: 'draft', visibility: 'public', profile: 'other', publishedAt: null });
    expect(e.slug).toBe(`spring-gala-${a.org.slug}`);
  });

  it('rejects end before start and a taken slug (globally, across orgs)', async () => {
    await expect(
      executeCommand(
        createEventCommand,
        { ...base, name: 'Backwards', endsAt: '2027-05-01T22:00:00Z' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(createEventCommand, { ...base, name: 'Copy', slug: a.event.slug }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'slug' } });
  });

  it('follows the lifecycle and refuses illegal transitions', async () => {
    const e = await executeCommand(
      createEventCommand,
      { ...base, name: `Lifecycle ${a.org.slug}` },
      a.ctx(),
      ports,
    );
    await expect(transition(e.id, 'complete')).rejects.toMatchObject({ code: 'invalid_state' });
    const pub = await transition(e.id, 'publish');
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBeInstanceOf(Date);
    expect((await transition(e.id, 'postpone')).status).toBe('postponed');
    expect((await transition(e.id, 'cancel')).status).toBe('cancelled');
    await expect(transition(e.id, 'publish')).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await transition(e.id, 'archive')).status).toBe('archived');
  });

  it('an update changes only the fields it names (regression: defaults used to reset the rest)', async () => {
    const e = await executeCommand(
      createEventCommand,
      {
        name: 'Keep Fields',
        tagline: 'Stay',
        venueName: 'Hall A',
        city: 'Lyon',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        startsAt: '2027-05-01T08:00:00Z',
        endsAt: '2027-05-01T18:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const u = await executeCommand(
      updateEventCommand,
      { eventId: e.id, name: 'Kept Fields' },
      a.ctx(),
      ports,
    );
    expect(u).toMatchObject({
      name: 'Kept Fields',
      tagline: 'Stay',
      venueName: 'Hall A',
      city: 'Lyon',
      currency: 'EUR',
    });
  });

  it('freezes the slug once published', async () => {
    const e = await executeCommand(
      createEventCommand,
      { ...base, name: `Frozen ${a.org.slug}` },
      a.ctx(),
      ports,
    );
    await transition(e.id, 'publish');
    await expect(
      executeCommand(updateEventCommand, { eventId: e.id, slug: `renamed-${a.org.slug}` }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const renamed = await executeCommand(
      updateEventCommand,
      { eventId: e.id, name: 'Frozen, renamed' },
      a.ctx(),
      ports,
    );
    expect(renamed.name).toBe('Frozen, renamed');
  });

  it('shows the public page only for published, non-private events, with allowlisted fields', async () => {
    const e = await executeCommand(
      createEventCommand,
      { ...base, name: `Public ${a.org.slug}`, tagline: 'Hello' },
      a.ctx(),
      ports,
    );
    expect(await publicEventBySlug(e.slug)).toBeNull();
    await transition(e.id, 'publish');
    const pub = await publicEventBySlug(e.slug);
    expect(pub).toMatchObject({
      name: `Public ${a.org.slug}`,
      organizerName: 'Alpha Events',
      status: 'published',
    });
    expect(Object.keys(pub ?? {})).not.toContain('orgId');
    await executeCommand(updateEventCommand, { eventId: e.id, visibility: 'private' }, a.ctx(), ports);
    expect(await publicEventBySlug(e.slug)).toBeNull();
  });

  it('isolation: an org sees only its own events, and cannot touch another org’s event', async () => {
    const mine = await executeQuery(listEventsQuery, {}, b.ctx(), ports);
    expect(mine.every((e) => e.id !== a.event.id)).toBe(true);
    await expect(
      executeQuery(getEventBySlugQuery, { slug: a.event.slug }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(transition(a.event.id, 'publish', b.ctx())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a viewer can read events but not create them', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listEventsQuery, {}, viewer, ports)).length).toBeGreaterThan(0);
    await expect(
      executeCommand(createEventCommand, { ...base, name: 'Nope' }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
