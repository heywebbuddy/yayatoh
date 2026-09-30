import {
  createEntryCommand,
  deleteEntryCommand,
  type EntryDto,
  getEntryQuery,
  listEntriesQuery,
  navPages,
  publicEntries,
  publicEntry,
  setEntryStatusCommand,
  sitemapEntries,
  updateEntryCommand,
} from '@yayatoh/cms';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { publicSiteSettings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let marketerId: string;

const create = (input: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(createEntryCommand, { kind: 'post', body: '', ...input } as never, ctx, ports);
const status = (entryId: string, action: 'publish' | 'unpublish' | 'archive', ctx = a.ctx()) =>
  executeCommand(setEntryStatusCommand, { entryId, action }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  marketerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: marketerId, role: 'marketing' }, a.ctx(), ports);
});
afterAll(closePools);

describe('CMS entries (M1.4g)', () => {
  let post: EntryDto;

  it('creates a draft with a derived slug; a clash takes the next suffix; bodies are sanitized', async () => {
    post = await create({ title: 'Summer Line-up', body: 'Hi\u0000 <script>x</script>‮', authorName: 'Pani' });
    expect(post).toMatchObject({ kind: 'post', slug: 'summer-line-up', status: 'draft', publishedAt: null });
    expect(post.body).toBe('Hi <script>x</script>');
    const again = await create({ title: 'Summer line up!' });
    expect(again.slug).toBe('summer-line-up-2');
    // Pages and posts have separate address spaces.
    expect((await create({ kind: 'page', title: 'Summer line-up' })).slug).toBe('summer-line-up');
  });

  it('refuses a typed slug that is taken or malformed, naming the field', async () => {
    await expect(create({ title: 'Other', slug: 'summer-line-up' })).rejects.toMatchObject({
      code: 'conflict',
      details: { issues: [{ path: 'slug', code: 'taken' }] },
    });
    await expect(create({ title: 'Other', slug: 'bad slug' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ path: 'slug', code: 'format' }] },
    });
  });

  it('publishes, freezes the slug, keeps the first publish date, and hides drafts publicly', async () => {
    expect(await publicEntry(a.org.id, 'post', post.slug)).toBeNull();
    const pub = await status(post.id, 'publish');
    expect(pub.status).toBe('published');
    const first = pub.publishedAt;
    expect(first).toBeInstanceOf(Date);
    const shown = await publicEntry(a.org.id, 'post', post.slug);
    expect(shown).toMatchObject({ title: 'Summer Line-up', authorName: 'Pani' });
    expect(Object.keys(shown ?? {})).not.toContain('id');
    expect(Object.keys(shown ?? {})).not.toContain('authorUserId');
    await expect(
      executeCommand(updateEntryCommand, { entryId: post.id, slug: 'renamed' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await status(post.id, 'unpublish');
    expect(await publicEntry(a.org.id, 'post', post.slug)).toBeNull();
    await expect(status(post.id, 'unpublish')).rejects.toMatchObject({ code: 'invalid_state' });
    const again = await status(post.id, 'publish');
    expect(again.publishedAt).toEqual(first);
    await status(post.id, 'archive');
    expect(await publicEntry(a.org.id, 'post', post.slug)).toBeNull();
    await status(post.id, 'publish');
  });

  it('lists published posts newest first with pagination; sitemap lists only published', async () => {
    const list = await publicEntries(a.org.id, 'post');
    expect(list.items.map((i) => i.slug)).toContain(post.slug);
    expect(list.items.map((i) => i.slug)).not.toContain('summer-line-up-2');
    const map = await sitemapEntries(a.org.id);
    expect(map.find((m) => m.slug === post.slug && m.kind === 'post')).toBeTruthy();
    expect(map.find((m) => m.slug === 'summer-line-up-2')).toBeUndefined();
  });

  it('permissions: viewers read only; marketing writes; another org cannot touch it', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listEntriesQuery, {}, viewer, ports)).length).toBeGreaterThan(0);
    await expect(create({ title: 'Viewer post' }, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(status(post.id, 'unpublish', viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(deleteEntryCommand, { entryId: post.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const marketer = userCtx(marketerId, a.org.id);
    const m = await create({ title: 'Marketing post' }, marketer);
    expect(m.status).toBe('draft');
    // Org B: the entry does not exist there.
    await expect(executeQuery(getEntryQuery, { entryId: post.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(status(post.id, 'archive', b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect(await publicEntry(b.org.id, 'post', post.slug)).toBeNull();
    // B's fixture post is never in A's public list.
    expect((await publicEntries(a.org.id, 'post')).items.some((i) => i.title.includes('Bravo'))).toBe(false);
  });

  it('every write is audited and publishing emits cms.post_published@1', async () => {
    const rows = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id = ${post.id} order by seq`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'cms.entry.create',
        'cms.entry.publish',
        'cms.entry.unpublish',
        'cms.entry.archive',
      ]),
    );
    const events = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ type: string; version: number }>(
        sql`select type, version from platform.domain_events where aggregate_id = ${post.id}`,
      ),
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['cms.entry_created', 'cms.post_published', 'cms.entry_unpublished']),
    );
  });

  it('site navigation links only this org’s pages, shows published ones in order', async () => {
    const p1 = await create({ kind: 'page', title: 'FAQ' });
    const p2 = await create({ kind: 'page', title: 'Contact' });
    await status(p2.id, 'publish');
    await executeCommand(updateSiteSettingsCommand, { navPageIds: [p2.id, p1.id] }, a.ctx(), ports);
    expect((await publicSiteSettings(a.org.id)).navPageIds).toEqual([p2.id, p1.id]);
    expect(await navPages(a.org.id, [p2.id, p1.id])).toEqual([{ slug: 'contact', title: 'Contact' }]);
    await status(p1.id, 'publish');
    expect((await navPages(a.org.id, [p2.id, p1.id])).map((p) => p.slug)).toEqual(['contact', 'faq']);
    // A post, or another org's page, can't be linked.
    await expect(
      executeCommand(updateSiteSettingsCommand, { navPageIds: [post.id] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const bPages = await executeQuery(listEntriesQuery, { kind: 'page' }, b.ctx(), ports);
    await expect(
      executeCommand(updateSiteSettingsCommand, { navPageIds: [bPages[0]?.id ?? ''] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Viewers can't change navigation.
    await expect(
      executeCommand(updateSiteSettingsCommand, { navPageIds: [] }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('delete removes it everywhere', async () => {
    const d = await create({ title: 'Delete me' });
    await status(d.id, 'publish');
    await executeCommand(deleteEntryCommand, { entryId: d.id }, a.ctx(), ports);
    expect(await publicEntry(a.org.id, 'post', d.slug)).toBeNull();
    await expect(executeQuery(getEntryQuery, { entryId: d.id }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
