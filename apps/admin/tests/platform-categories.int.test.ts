import { withoutTenant, withTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import {
  addOrgCategoryCommand,
  createEventCommand,
  createEventInSeriesCommand,
  eventDetailsQuery,
  listPlatformCategoryCatalog,
  orgCategoriesQuery,
  searchEventsQuery,
  setEventDetailsCommand,
  setOrgCategoryHiddenCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpListings, orgListings, parseSearchV2Params } from '@yayatoh/marketplace';
import { acceptAgreementCommand, createOrganization, PLATFORM_AGREEMENTS } from '@yayatoh/tenancy';
import { ports, userCtx } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPlatformCategory,
  listPlatformCategories,
  moveKey,
  parseDefaultKeys,
  savePlatformDefaults,
} from '../src/server/platform-categories.ts';

beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(closePools);

const tag = uuidv7().slice(-8);
const ACTOR = `staff:${uuidv7()}`;

async function newOrg(name: string) {
  const ownerId = uuidv7();
  const org = await createOrganization(userCtx(ownerId), { slug: `${name}-${tag}`, name }, ports);
  return userCtx(ownerId, org.id);
}

describe('platform default categories (U8)', () => {
  it('parses the posted order and moves one step', () => {
    expect(parseDefaultKeys(['music', 'technology'])).toEqual(['music', 'technology']);
    expect(parseDefaultKeys([])).toBeNull();
    expect(parseDefaultKeys(['music', 'music'])).toBeNull();
    expect(parseDefaultKeys(['karaoke'])).toEqual(['karaoke']);
    expect(parseDefaultKeys(['Invalid-key'])).toBeNull();
    expect(moveKey(['a', 'b', 'c'], 'c', 'up')).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
  });

  it('creates a catalog category usable by organizers, event details and search; rejects invalid and duplicate writes', async () => {
    const key = `comedy_${tag}`;
    const label = `Comedy ${tag}`;
    const kept = await newOrg('customized');
    await executeCommand(addOrgCategoryCommand, { name: 'Local name' }, kept, ports);
    const before = await executeQuery(orgCategoriesQuery, {}, kept, ports);
    await createPlatformCategory(ACTOR, { key, label, include: true });
    expect((await listPlatformCategories(ACTOR)).find((c) => c.key === key)).toMatchObject({
      label,
      inDefaults: true,
      updatedBy: ACTOR,
    });
    expect((await listPlatformCategoryCatalog()).find((c) => c.key === key)?.label).toBe(label);
    const fresh = await newOrg('dynamic');
    expect((await executeQuery(orgCategoriesQuery, {}, fresh, ports)).some((c) => c.ref === key)).toBe(true);
    expect(await executeQuery(orgCategoriesQuery, {}, kept, ports)).toEqual(before);
    const mapped = await executeCommand(
      addOrgCategoryCommand,
      { name: 'Comedy nights', platformKey: key },
      kept,
      ports,
    );
    expect(mapped.platformKey).toBe(key);
    const ev = await executeCommand(
      createEventCommand,
      {
        name: 'Comedy event',
        orgCategory: key,
        timezone: 'Asia/Kolkata',
        startsAt: '2031-06-01T18:00:00Z',
        endsAt: '2031-06-01T22:00:00Z',
      },
      fresh,
      ports,
    );
    expect((await executeQuery(eventDetailsQuery, { eventId: ev.id }, fresh, ports)).category).toBe(key);
    expect(
      (await executeQuery(searchEventsQuery, { categoryRef: key }, fresh, ports)).map((e) => e.id),
    ).toContain(ev.id);
    expect(parseSearchV2Params({ category: key }).category).toBe(key);
    await executeCommand(
      acceptAgreementCommand,
      { document: 'platform_tos', version: PLATFORM_AGREEMENTS.platform_tos.version },
      fresh,
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, fresh, ports);
    await catchUpListings(fresh.orgId as string);
    expect((await orgListings(fresh.orgId as string)).items.map((e) => e.slug)).toContain(ev.slug);
    const [projected] = await withTenant(fresh, (tx) =>
      tx.execute<{ category: string }>(
        sql`select category from marketplace.public_listings where event_id = ${ev.id}`,
      ),
    );
    expect(projected?.category).toBe(key);
    await expect(
      executeCommand(setEventDetailsCommand, { eventId: ev.id, category: 'unknown_category' }, fresh, ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(createPlatformCategory(ACTOR, { key, label: 'Another', include: false })).rejects.toThrow();
    await expect(
      createPlatformCategory(ACTOR, { key: `${key}_two`, label: label.toUpperCase(), include: false }),
    ).rejects.toThrow();
    await expect(
      createPlatformCategory('system:test', { key: `${key}_three`, label: 'Refused', include: false }),
    ).rejects.toThrow();
    await expect(
      createPlatformCategory(ACTOR, { key: 'Wrong key', label: 'Refused', include: true }),
    ).rejects.toThrow();
    await expect(
      withoutTenant((tx) =>
        tx.execute(
          sql`insert into events.platform_categories(key, label, position) values ('unauthorized', 'Unauthorized', 999)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('creates a categorized draft in a series; refuses hidden and foreign organization categories atomically', async () => {
    const ctx = await newOrg('creation');
    const custom = await executeCommand(
      addOrgCategoryCommand,
      { name: 'Local concerts', platformKey: 'music' },
      ctx,
      ports,
    );
    const input = {
      name: 'Categorized draft',
      timezone: 'Asia/Kolkata',
      startsAt: '2031-06-01T18:00:00Z',
      endsAt: '2031-06-01T22:00:00Z',
      orgCategory: custom.ref,
    };
    const created = await executeCommand(
      createEventInSeriesCommand,
      { event: input, newSeriesName: 'Concert season' },
      ctx,
      ports,
    );
    expect(await executeQuery(eventDetailsQuery, { eventId: created.id }, ctx, ports)).toMatchObject({
      category: 'music',
      categoryRef: custom.ref,
      categoryName: 'Local concerts',
    });
    const other = await newOrg('other-creation');
    await expect(executeCommand(createEventCommand, input, other, ports)).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'orgCategory' },
    });
    expect(await executeQuery(searchEventsQuery, {}, other, ports)).toHaveLength(0);
    await executeCommand(setOrgCategoryHiddenCommand, { category: custom.ref, hidden: true }, ctx, ports);
    await expect(
      executeCommand(createEventCommand, { ...input, name: 'Hidden draft' }, ctx, ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'orgCategory' } });
    expect(await executeQuery(searchEventsQuery, {}, ctx, ports)).toHaveLength(1);
    const uncategorized = await executeCommand(
      createEventCommand,
      { ...input, name: 'Uncategorized draft', orgCategory: null },
      other,
      ports,
    );
    expect(
      (await executeQuery(eventDetailsQuery, { eventId: uncategorized.id }, other, ports)).category,
    ).toBeNull();
  });

  it('staff decide what a new org starts with; orgs with their own list keep it; audited', async () => {
    const before = (await listPlatformCategories(ACTOR)).filter((r) => r.inDefaults).map((r) => r.key);
    const kept = await newOrg('kept');
    await executeCommand(addOrgCategoryCommand, { name: 'Ours' }, kept, ports);
    const keptRefs = (await executeQuery(orgCategoriesQuery, { includeHidden: true }, kept, ports)).map(
      (c) => c.ref,
    );
    try {
      expect(await savePlatformDefaults(ACTOR, ['technology', 'music'])).toBe(2);
      const rows = await listPlatformCategories(ACTOR);
      expect(rows.filter((r) => r.inDefaults).map((r) => r.key)).toEqual(['technology', 'music']);
      expect(rows.find((r) => r.key === 'music')?.updatedBy).toBe(ACTOR);
      expect(rows.length).toBeGreaterThanOrEqual(16);

      const fresh = await newOrg('fresh');
      const list = await executeQuery(orgCategoriesQuery, {}, fresh, ports);
      expect(list.map((c) => c.ref)).toEqual(['technology', 'music']);
      expect(
        (await executeQuery(orgCategoriesQuery, { includeHidden: true }, kept, ports)).map((c) => c.ref),
      ).toEqual(keptRefs);

      // The function refuses an empty list, duplicates, unknown keys and non-staff actors.
      await expect(savePlatformDefaults(ACTOR, [])).rejects.toThrow();
      await expect(savePlatformDefaults(ACTOR, ['music', 'music'])).rejects.toThrow();
      await expect(savePlatformDefaults(ACTOR, ['karaoke'])).rejects.toThrow();
      await expect(savePlatformDefaults('system:x', ['music'])).rejects.toThrow();
      // app_user reads the list but never writes it.
      await expect(
        withoutTenant((tx) => tx.execute(sql`update events.platform_categories set in_defaults = false`)),
      ).rejects.toThrow();
      // Every read and write is in the access log with the staff actor.
      const [log] = await withPlatformReader({ actor: 'test', reason: 'read access log' }, (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from platform.access_log where actor = ${ACTOR} and reason like '%platform default categories%'`,
        ),
      );
      expect(Number(log?.n)).toBeGreaterThanOrEqual(3);
    } finally {
      await savePlatformDefaults(ACTOR, before);
    }
  });
});
