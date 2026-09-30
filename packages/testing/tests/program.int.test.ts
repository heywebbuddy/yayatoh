import { effectiveModules, setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  cancelOccurrenceCommand,
  createEventCommand,
  type EventDto,
  pageTarget,
  transitionEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { navIncludes } from '@yayatoh/platform';
import {
  createExhibitorCommand,
  createRoomCommand,
  createSessionCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  createTrackCommand,
  deleteRoomCommand,
  deleteSessionCommand,
  deleteSpeakerCommand,
  deleteSponsorTierCommand,
  deleteTrackCommand,
  programCountsQuery,
  programQuery,
  publicProgram,
  publicSpeaker,
  updateExhibitorCommand,
  updateSessionCommand,
  updateSpeakerCommand,
  updateSponsorCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;

const H = 3_600_000;
const at = (h: number, base = ev) => new Date(base.startsAt.getTime() + h * H);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await executeCommand(
    createEventCommand,
    {
      name: `Program Summit ${a.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-05-01T14:00:00Z',
      endsAt: '2030-05-02T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
});

afterAll(async () => {
  await closePools();
});

describe('program: sessions, rooms, tracks (M1.4f)', () => {
  it('creates a session with room, track and speakers; conflicts are warnings, not errors', async () => {
    const room = await executeCommand(
      createRoomCommand,
      { eventId: ev.id, name: 'Main hall' },
      a.ctx(),
      ports,
    );
    const track = await executeCommand(
      createTrackCommand,
      { eventId: ev.id, name: 'Leadership' },
      a.ctx(),
      ports,
    );
    const p = await executeCommand(
      createSpeakerCommand,
      { eventId: ev.id, name: 'Ada Lovelace' },
      a.ctx(),
      ports,
    );
    const first = await executeCommand(
      createSessionCommand,
      {
        eventId: ev.id,
        title: 'Keynote',
        startsAt: at(0),
        endsAt: at(1),
        roomId: room.id,
        trackId: track.id,
        speakerIds: [p.id],
      },
      a.ctx(),
      ports,
    );
    expect(first.warnings).toEqual([]);
    expect(first.session.speakerIds).toEqual([p.id]);
    const clash = await executeCommand(
      createSessionCommand,
      {
        eventId: ev.id,
        title: 'Panel',
        startsAt: at(0.5),
        endsAt: at(1.5),
        roomId: room.id,
        speakerIds: [p.id],
      },
      a.ctx(),
      ports,
    );
    expect(clash.warnings.map((w) => w.kind).sort()).toEqual(['room_overlap', 'speaker_overlap']);
    expect(clash.warnings.every((w) => w.otherId === first.session.id)).toBe(true);
    // Moving it after the keynote clears both warnings.
    const moved = await executeCommand(
      updateSessionCommand,
      {
        eventId: ev.id,
        sessionId: clash.session.id,
        title: 'Panel',
        startsAt: at(1),
        endsAt: at(2),
        roomId: room.id,
        speakerIds: [p.id],
      },
      a.ctx(),
      ports,
    );
    expect(moved.warnings).toEqual([]);
    const program = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(program.sessions.map((s) => s.title)).toEqual(['Keynote', 'Panel']);
    expect(program.warnings).toEqual([]);
    // Deleting the room keeps the sessions (they just lose the room); same for the track.
    await executeCommand(deleteRoomCommand, { eventId: ev.id, roomId: room.id }, a.ctx(), ports);
    await executeCommand(deleteTrackCommand, { eventId: ev.id, trackId: track.id }, a.ctx(), ports);
    const after = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.sessions.every((s) => s.roomId === null && s.trackId === null)).toBe(true);
    expect(after.rooms).toEqual([]);
  });

  it('flags a session outside the event span', async () => {
    const res = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title: 'Afterparty', startsAt: at(40), endsAt: at(42) },
      a.ctx(),
      ports,
    );
    expect(res.warnings).toEqual([expect.objectContaining({ kind: 'outside_event', otherId: null })]);
    await executeCommand(deleteSessionCommand, { eventId: ev.id, sessionId: res.session.id }, a.ctx(), ports);
  });

  it('validates times, names and references', async () => {
    const bad = (input: Record<string, unknown>) =>
      executeCommand(
        createSessionCommand,
        { eventId: ev.id, title: 'X', startsAt: at(1), endsAt: at(2), ...input } as never,
        a.ctx(),
        ports,
      );
    await expect(bad({ endsAt: at(0.5) })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(bad({ title: '   ' })).rejects.toMatchObject({ code: 'validation_failed' });
    // Another org's room (RLS hides it) and a room of another event are both "unknown".
    const foreignRoom = await executeCommand(
      createRoomCommand,
      { eventId: b.event.id, name: 'B room' },
      b.ctx(),
      ports,
    );
    await expect(bad({ roomId: foreignRoom.id })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'roomId', reason: 'unknown' },
    });
    const otherEventRoom = await executeCommand(
      createRoomCommand,
      { eventId: a.event.id, name: 'Other' },
      a.ctx(),
      ports,
    );
    await expect(bad({ roomId: otherEventRoom.id })).rejects.toMatchObject({ details: { field: 'roomId' } });
    const foreignSpeaker = await executeCommand(
      createSpeakerCommand,
      { eventId: b.event.id, name: 'B' },
      b.ctx(),
      ports,
    );
    await expect(bad({ speakerIds: [foreignSpeaker.id] })).rejects.toMatchObject({
      details: { field: 'speakerIds' },
    });
    // Room names are unique per event (case-insensitive).
    await executeCommand(createRoomCommand, { eventId: ev.id, name: 'Studio' }, a.ctx(), ports);
    await expect(
      executeCommand(createRoomCommand, { eventId: ev.id, name: 'STUDIO' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'name' } });
  });

  it('a session on a date must fall within that scheduled date', async () => {
    const multi = await executeCommand(
      createEventCommand,
      {
        name: `Multi ${a.org.slug}`,
        timezone: 'UTC',
        startsAt: '2030-06-01T09:00:00Z',
        endsAt: '2030-06-01T17:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const [d1, d2] = await executeCommand(
      addOccurrencesCommand,
      {
        eventId: multi.id,
        dates: [
          { startsAt: '2030-06-01T09:00:00Z', endsAt: '2030-06-01T17:00:00Z' },
          { startsAt: '2030-06-08T09:00:00Z', endsAt: '2030-06-08T17:00:00Z' },
        ],
      },
      a.ctx(),
      ports,
    );
    if (!d1 || !d2) throw new Error('dates');
    const ok = await executeCommand(
      createSessionCommand,
      {
        eventId: multi.id,
        occurrenceId: d2.id,
        title: 'Week 2 workshop',
        startsAt: '2030-06-08T10:00:00Z',
        endsAt: '2030-06-08T11:00:00Z',
      },
      a.ctx(),
      ports,
    );
    expect(ok.session.occurrenceId).toBe(d2.id);
    await expect(
      executeCommand(
        createSessionCommand,
        {
          eventId: multi.id,
          occurrenceId: d1.id,
          title: 'Wrong day',
          startsAt: '2030-06-08T10:00:00Z',
          endsAt: '2030-06-08T11:00:00Z',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'startsAt', reason: 'outside_date' } });
    await executeCommand(cancelOccurrenceCommand, { occurrenceId: d1.id }, a.ctx(), ports);
    await expect(
      executeCommand(
        createSessionCommand,
        {
          eventId: multi.id,
          occurrenceId: d1.id,
          title: 'Cancelled day',
          startsAt: '2030-06-01T10:00:00Z',
          endsAt: '2030-06-01T11:00:00Z',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'occurrenceId', reason: 'cancelled' } });
  });
});

describe('program: speakers, exhibitors, sponsors', () => {
  it('speaker CRUD sanitizes the bio and accepts only http(s) links; deleting unlinks sessions', async () => {
    const p = await executeCommand(
      createSpeakerCommand,
      {
        eventId: ev.id,
        name: 'Grace Hopper',
        title: 'Rear Admiral',
        company: 'US Navy',
        bio: 'Compilers‮ **pioneer**',
        links: [{ label: 'Site', url: 'https://example.com/grace' }],
      },
      a.ctx(),
      ports,
    );
    expect(p.bio).toBe('Compilers **pioneer**');
    await expect(
      executeCommand(
        updateSpeakerCommand,
        {
          eventId: ev.id,
          speakerId: p.id,
          name: 'Grace',
          links: [{ label: 'x', url: 'javascript:alert(1)' }],
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const s = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title: 'COBOL at 70', startsAt: at(3), endsAt: at(4), speakerIds: [p.id] },
      a.ctx(),
      ports,
    );
    await executeCommand(deleteSpeakerCommand, { eventId: ev.id, speakerId: p.id }, a.ctx(), ports);
    const program = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(program.sessions.find((x) => x.id === s.session.id)?.speakerIds).toEqual([]);
  });

  it('exhibitors and sponsor tiers: order, website validation, a tier in use cannot be deleted', async () => {
    const ex = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Acme', boothLabel: 'B12', websiteUrl: 'https://acme.test' },
      a.ctx(),
      ports,
    );
    expect(ex.boothLabel).toBe('B12');
    await expect(
      executeCommand(
        updateExhibitorCommand,
        { eventId: ev.id, exhibitorId: ex.id, name: 'Acme', websiteUrl: 'ftp://acme.test' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const silver = await executeCommand(
      createSponsorTierCommand,
      { eventId: ev.id, name: 'Silver', position: 2 },
      a.ctx(),
      ports,
    );
    const gold = await executeCommand(
      createSponsorTierCommand,
      { eventId: ev.id, name: 'Gold', position: 1 },
      a.ctx(),
      ports,
    );
    const sp = await executeCommand(
      createSponsorCommand,
      { eventId: ev.id, tierId: silver.id, name: 'Initech' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      updateSponsorCommand,
      { eventId: ev.id, sponsorId: sp.id, tierId: gold.id, name: 'Initech' },
      a.ctx(),
      ports,
    );
    const program = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(program.sponsorTiers.map((t) => t.name)).toEqual(['Gold', 'Silver']);
    await expect(
      executeCommand(deleteSponsorTierCommand, { eventId: ev.id, tierId: gold.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'tier_in_use' } });
    await executeCommand(deleteSponsorTierCommand, { eventId: ev.id, tierId: silver.id }, a.ctx(), ports);
    // A tier of another event is refused.
    const otherTier = await executeCommand(
      createSponsorTierCommand,
      { eventId: a.event.id, name: 'Other', position: 1 },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        createSponsorCommand,
        { eventId: ev.id, tierId: otherTier.id, name: 'X' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'tierId' } });
  });
});

describe('program: permissions, isolation, profile visibility', () => {
  it('a viewer reads the program but every write is forbidden', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const program = await executeQuery(programQuery, { eventId: ev.id }, viewer, ports);
    expect(program.sessions.length).toBeGreaterThan(0);
    for (const [cmd, input] of [
      [createSessionCommand, { eventId: ev.id, title: 'X', startsAt: at(1), endsAt: at(2) }],
      [createSpeakerCommand, { eventId: ev.id, name: 'X' }],
      [createExhibitorCommand, { eventId: ev.id, name: 'X' }],
      [createSponsorTierCommand, { eventId: ev.id, name: 'X', position: 3 }],
      [createRoomCommand, { eventId: ev.id, name: 'X' }],
      [createTrackCommand, { eventId: ev.id, name: 'X' }],
    ] as const)
      await expect(executeCommand(cmd as never, input as never, viewer, ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
  });

  it('another org can neither read nor change this program', async () => {
    await expect(executeQuery(programQuery, { eventId: ev.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const mine = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    const session = mine.sessions[0];
    if (!session) throw new Error('no session');
    await expect(
      executeCommand(deleteSessionCommand, { eventId: ev.id, sessionId: session.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(createSpeakerCommand, { eventId: ev.id, name: 'Intruder' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Raw SQL under b's tenant sees none of a's program rows.
    const rows = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from program.sessions where event_id = ${ev.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('nav items follow the profile and the modules; a revoked module refuses its commands', async () => {
    const modules = await effectiveModules(a.ctx());
    expect(navIncludes('conference', modules, 'speakers')).toBe(true);
    expect(navIncludes('concert', modules, 'speakers')).toBe(false);
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'speakers', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      expect(navIncludes('conference', await effectiveModules(a.ctx()), 'speakers')).toBe(false);
      await expect(
        executeCommand(createSpeakerCommand, { eventId: ev.id, name: 'Nope' }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'speakers', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('program: public reads', () => {
  it('drafts have no public page; once published the program is allowlisted', async () => {
    expect(await pageTarget(ev.slug)).toBeNull();
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const target = await pageTarget(ev.slug);
    if (!target) throw new Error('no page');
    const pub = await publicProgram(target);
    expect(pub.sessions.length).toBeGreaterThan(0);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('capacity');
    expect(json).not.toContain('orgId');
    expect(json).not.toContain(a.org.id);
    expect(pub.sponsorTiers.map((t) => t.name)).toEqual(['Gold']);
    const counts = await executeQuery(programCountsQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(counts.sessions).toBe(pub.sessions.length);
    expect(counts.exhibitors).toBe(1);
  });

  it('a speaker page lists their sessions; unknown and foreign speakers are null', async () => {
    const target = await pageTarget(ev.slug);
    if (!target) throw new Error('no page');
    const p = await executeCommand(
      createSpeakerCommand,
      { eventId: ev.id, name: 'Katherine Johnson' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title: 'Orbits', startsAt: at(5), endsAt: at(6), speakerIds: [p.id] },
      a.ctx(),
      ports,
    );
    const page = await publicSpeaker(target, p.id);
    expect(page?.speaker.name).toBe('Katherine Johnson');
    expect(page?.sessions.map((s) => s.title)).toEqual(['Orbits']);
    expect(page?.sessions[0]?.speakers).toEqual([{ id: p.id, name: 'Katherine Johnson' }]);
    const foreign = await executeCommand(
      createSpeakerCommand,
      { eventId: b.event.id, name: 'Other org' },
      b.ctx(),
      ports,
    );
    expect(await publicSpeaker(target, foreign.id)).toBeNull();
    expect(await publicSpeaker(target, 'not-a-uuid')).toBeNull();
  });
});
