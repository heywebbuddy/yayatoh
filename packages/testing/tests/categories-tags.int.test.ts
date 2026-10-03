import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import {
  addOrgCategoryCommand,
  createEventCommand,
  type EventDto,
  eventDetailsQuery,
  eventLabelsQuery,
  listEventsQuery,
  moveOrgCategoryCommand,
  orgCategoriesQuery,
  renameOrgCategoryCommand,
  searchEventsQuery,
  setEventDetailsCommand,
  setOrgCategoryHiddenCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpListings, orgListings, orgListingTags } from '@yayatoh/marketplace';
import { createOrganization } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);
const viewer = (o: OrgFixture) => userCtx(o.viewerId, o.org.id);

async function event(o: OrgFixture, name: string): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `${name} ${tag}`,
      timezone: 'America/Chicago',
      startsAt: '2031-06-01T18:00:00Z',
      endsAt: '2031-06-01T22:00:00Z',
    },
    o.ctx(),
    ports,
  );
}
const categories = (o: OrgFixture, includeHidden = false) =>
  executeQuery(orgCategoriesQuery, { includeHidden }, o.ctx(), ports);

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('org categories (U8)', () => {
  it('a new org starts with the platform defaults, unstored, addressed by platform key', async () => {
    const ownerId = uuidv7();
    const org = await createOrganization(
      userCtx(ownerId),
      { slug: `fresh-${tag}`, name: 'Fresh Org' },
      ports,
    );
    const ctx = userCtx(ownerId, org.id);
    const list = await executeQuery(orgCategoriesQuery, { includeHidden: true }, ctx, ports);
    const defaults = await withoutTenant((tx) =>
      tx.execute<{ key: string }>(
        sql`select key from events.platform_categories where in_defaults order by position, key`,
      ),
    );
    expect(list.map((c) => c.ref)).toEqual(defaults.map((d) => d.key));
    expect(list.every((c) => c.id === null && c.name === null && !c.hidden)).toBe(true);
    // The first change stores the list, keeping refs of unchanged defaults.
    const added = await executeCommand(addOrgCategoryCommand, { name: ' Pop-up  dinners ' }, ctx, ports);
    expect(added).toMatchObject({ name: 'Pop-up dinners', platformKey: 'other', hidden: false });
    expect(added.ref).toBe(added.id);
    const stored = await executeQuery(orgCategoriesQuery, {}, ctx, ports);
    expect(stored.map((c) => c.ref)).toEqual([...defaults.map((d) => d.key), added.id]);
    expect(stored.every((c) => c.id !== null)).toBe(true);
  });

  it('staff decide the defaults a new org starts with; orgs with a stored list keep theirs', async () => {
    const actor = `staff:${uuidv7()}`;
    const before = await withoutTenant((tx) =>
      tx.execute<{ key: string }>(
        sql`select key from events.platform_categories where in_defaults order by position, key`,
      ),
    );
    const save = (keys: string[]) =>
      withPlatformReader(
        { actor, reason: 'test: platform default categories' },
        (tx) =>
          tx.execute(
            sql`select events.set_platform_default_categories(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)), ${actor})`,
          ),
        { callsWritingFunctions: true },
      );
    const aBefore = (await categories(a, true)).map((c) => c.ref);
    try {
      await save(['technology', 'music']);
      const ownerId = uuidv7();
      const org = await createOrganization(
        userCtx(ownerId),
        { slug: `staffd-${tag}`, name: 'Staff Defaults' },
        ports,
      );
      const list = await executeQuery(orgCategoriesQuery, {}, userCtx(ownerId, org.id), ports);
      expect(list.map((c) => c.ref)).toEqual(['technology', 'music']);
      expect((await categories(a, true)).map((c) => c.ref)).toEqual(aBefore);
      // The function refuses an empty list, unknown keys, duplicates and non-staff actors.
      await expect(save([])).rejects.toThrow();
      await expect(save(['music', 'music'])).rejects.toThrow();
      await expect(save(['karaoke'])).rejects.toThrow();
      await expect(
        withPlatformReader(
          { actor, reason: 'test' },
          (tx) => tx.execute(sql`select events.set_platform_default_categories(array['music'], 'system:x')`),
          { callsWritingFunctions: true },
        ),
      ).rejects.toThrow();
      // app_user can read the list but never write it.
      await expect(
        withoutTenant((tx) => tx.execute(sql`update events.platform_categories set in_defaults = false`)),
      ).rejects.toThrow();
    } finally {
      await save(before.map((d) => d.key));
    }
  });

  it('add, rename, hide, show and move; names are validated and unique per org', async () => {
    const mine = await executeCommand(
      addOrgCategoryCommand,
      { name: `Galas ${tag}`, platformKey: 'charity' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(addOrgCategoryCommand, { name: `galas ${tag.toUpperCase()}` }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'name_taken', field: 'name' } });
    await expect(
      executeCommand(addOrgCategoryCommand, { name: '   ' }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'name_required' },
    });
    await expect(
      executeCommand(addOrgCategoryCommand, { name: 'x'.repeat(61) }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'name_too_long' } });
    // The same name in another org is fine.
    await executeCommand(addOrgCategoryCommand, { name: `Galas ${tag}` }, b.ctx(), ports);

    // Renaming a default keeps its platform key and gives it an id ref.
    const renamed = await executeCommand(
      renameOrgCategoryCommand,
      { category: 'music', name: `Live music ${tag}` },
      a.ctx(),
      ports,
    );
    expect(renamed).toMatchObject({ platformKey: 'music', name: `Live music ${tag}`, ref: renamed.id });

    // Move: one step at a time.
    const list = await categories(a, true);
    const at = list.findIndex((c) => c.id === mine.id);
    const moved = await executeCommand(
      moveOrgCategoryCommand,
      { category: mine.ref, direction: 'up' },
      a.ctx(),
      ports,
    );
    expect(moved.findIndex((c) => c.id === mine.id)).toBe(at - 1);
    expect(moved.map((c) => c.position)).toEqual(moved.map((_, i) => i));

    // Hide, then show.
    const hidden = await executeCommand(
      setOrgCategoryHiddenCommand,
      { category: mine.ref, hidden: true },
      a.ctx(),
      ports,
    );
    expect(hidden.hidden).toBe(true);
    expect((await categories(a)).some((c) => c.id === mine.id)).toBe(false);
    expect((await categories(a, true)).some((c) => c.id === mine.id)).toBe(true);
    await executeCommand(setOrgCategoryHiddenCommand, { category: mine.ref, hidden: false }, a.ctx(), ports);
    expect((await categories(a)).some((c) => c.id === mine.id)).toBe(true);
  });

  it('a hidden category leaves the pickers but keeps history on its events', async () => {
    const cat = await executeCommand(
      addOrgCategoryCommand,
      { name: `Retired ${tag}`, platformKey: 'family' },
      a.ctx(),
      ports,
    );
    const e = await event(a, 'Old Fair');
    const set = await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, orgCategory: cat.ref },
      a.ctx(),
      ports,
    );
    expect(set).toMatchObject({ categoryRef: cat.ref, categoryName: `Retired ${tag}`, category: 'family' });
    await executeCommand(setOrgCategoryHiddenCommand, { category: cat.ref, hidden: true }, a.ctx(), ports);

    expect((await categories(a)).some((c) => c.id === cat.id)).toBe(false);
    const details = await executeQuery(eventDetailsQuery, { eventId: e.id }, a.ctx(), ports);
    expect(details).toMatchObject({
      categoryRef: cat.ref,
      categoryName: `Retired ${tag}`,
      categoryHidden: true,
    });
    // The event list still shows and filters it.
    const found = await executeQuery(searchEventsQuery, { categoryRef: cat.ref }, a.ctx(), ports);
    expect(found.map((x) => x.id)).toEqual([e.id]);
    expect(found[0]?.categoryName).toBe(`Retired ${tag}`);
    // Saving the event's other details keeps it; another event can't newly pick it.
    await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, orgCategory: cat.ref, tags: ['kept'] },
      a.ctx(),
      ports,
    );
    const other = await event(a, 'New Fair');
    await expect(
      executeCommand(setEventDetailsCommand, { eventId: other.id, orgCategory: cat.ref }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { field: 'category' } });
    // Its count stays on the manage list.
    expect((await categories(a, true)).find((c) => c.id === cat.id)?.eventCount).toBe(1);
  });

  it('platform keys still work (older callers, /v1) and map to the org category', async () => {
    const e = await event(a, 'Key Night');
    const d = await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, category: 'technology' },
      a.ctx(),
      ports,
    );
    const tech = (await categories(a)).find((c) => c.platformKey === 'technology' && c.name === null);
    expect(d).toMatchObject({ category: 'technology', categoryRef: 'technology' });
    expect(tech?.eventCount).toBeGreaterThanOrEqual(1);
    const cleared = await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, orgCategory: null },
      a.ctx(),
      ports,
    );
    expect(cleared).toMatchObject({ category: null, categoryRef: null, categoryName: null });
  });

  it('only owners and admins manage categories; another org is never reachable', async () => {
    await expect(
      executeCommand(addOrgCategoryCommand, { name: `Viewer ${tag}` }, viewer(a), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await executeQuery(orgCategoriesQuery, {}, viewer(a), ports)).length).toBeGreaterThan(0);
    const aCat = await executeCommand(addOrgCategoryCommand, { name: `Alpha only ${tag}` }, a.ctx(), ports);
    // B can neither see, rename, hide nor use A's category.
    expect((await categories(b, true)).some((c) => c.id === aCat.id)).toBe(false);
    for (const run of [
      () => executeCommand(renameOrgCategoryCommand, { category: aCat.ref, name: 'Mine' }, b.ctx(), ports),
      () => executeCommand(setOrgCategoryHiddenCommand, { category: aCat.ref, hidden: true }, b.ctx(), ports),
      () => executeCommand(moveOrgCategoryCommand, { category: aCat.ref, direction: 'up' }, b.ctx(), ports),
      () =>
        executeCommand(
          setEventDetailsCommand,
          { eventId: b.event.id, orgCategory: aCat.ref },
          b.ctx(),
          ports,
        ),
    ])
      await expect(run()).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(searchEventsQuery, { categoryRef: aCat.ref }, b.ctx(), ports)).toEqual([]);
  });
});

describe('event tags (U8)', () => {
  it('tags filter /v1 (keyset list) and the public site, and never leak across orgs', async () => {
    const marker = `Mk${tag}`;
    const e = await event(a, 'Tagged Gala');
    const plain = await event(a, 'Plain Gala');
    await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, tags: [marker, 'Outdoor'] },
      a.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    await executeCommand(
      transitionEventCommand,
      { eventId: plain.id, transition: 'publish' },
      a.ctx(),
      ports,
    );

    // /v1's list: the tag filter (case-insensitive) and each event's tags.
    const listed = await executeQuery(
      listEventsQuery,
      { tag: marker.toUpperCase(), limit: 10 },
      a.ctx(),
      ports,
    );
    expect(listed.map((x) => x.id)).toEqual([e.id]);
    const labels = await executeQuery(eventLabelsQuery, { eventIds: [e.id, plain.id] }, a.ctx(), ports);
    expect(labels[e.id]?.tags).toEqual(
      [marker, 'Outdoor'].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())),
    );
    expect(labels[plain.id]?.tags).toEqual([]);

    // The public site (projection): the filter and the tag list.
    await catchUpListings(a.org.id);
    const site = await orgListings(a.org.id, 1, new Date(), { tag: marker.toLowerCase() });
    expect(site.items.map((i) => i.slug)).toEqual([e.slug]);
    expect((await orgListings(a.org.id)).items.map((i) => i.slug)).toEqual(
      expect.arrayContaining([e.slug, plain.slug]),
    );
    expect((await orgListingTags(a.org.id)).find((t) => t.key === marker.toLowerCase())).toEqual({
      key: marker.toLowerCase(),
      tag: marker,
      count: 1,
    });

    // Org B: none of A's tags or events, by any path.
    expect(await executeQuery(listEventsQuery, { tag: marker, limit: 10 }, b.ctx(), ports)).toEqual([]);
    expect(await executeQuery(eventLabelsQuery, { eventIds: [e.id] }, b.ctx(), ports)).toEqual({});
    expect(await executeQuery(searchEventsQuery, { tag: marker }, b.ctx(), ports)).toEqual([]);
    await catchUpListings(b.org.id);
    expect((await orgListings(b.org.id, 1, new Date(), { tag: marker })).items).toEqual([]);
    expect((await orgListingTags(b.org.id)).some((t) => t.key === marker.toLowerCase())).toBe(false);

    // Removing the tag takes the event out of the public filter.
    await executeCommand(setEventDetailsCommand, { eventId: e.id, tags: ['Outdoor'] }, a.ctx(), ports);
    await catchUpListings(a.org.id);
    expect((await orgListings(a.org.id, 1, new Date(), { tag: marker })).items).toEqual([]);
  });
});
