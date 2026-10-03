import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { addOrgCategoryCommand, orgCategoriesQuery } from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createOrganization } from '@yayatoh/tenancy';
import { ports, userCtx } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
    expect(parseDefaultKeys(['karaoke'])).toBeNull();
    expect(moveKey(['a', 'b', 'c'], 'c', 'up')).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
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
      expect(rows).toHaveLength(16);

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
