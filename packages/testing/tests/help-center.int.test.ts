import {
  createHelpArticleCommand,
  createHelpCategoryCommand,
  createSiteSectionCommand,
  deleteHelpArticleCommand,
  deleteHelpCategoryCommand,
  type HelpCategoryDto,
  helpSitemapEntries,
  listContactRequestsQuery,
  listHelpQuery,
  markContactHandledCommand,
  publicHelpArticle,
  publicHelpCenter,
  publicHelpSearchDocs,
  publicSiteSections,
  rankArticles,
  setHelpArticleStatusCommand,
  setSiteSectionStatusCommand,
  submitContactRequestCommand,
  submitHelpFeedbackCommand,
  updateHelpArticleCommand,
  updateHelpCategoryCommand,
  updateSiteSectionCommand,
} from '@yayatoh/cms';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter, RATE_LIMIT_POLICIES } from '@yayatoh/platform/security';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let marketerId: string;
let organizers: HelpCategoryDto;
let buyers: HelpCategoryDto;

// biome-ignore lint/suspicious/noExplicitAny: one helper for every cms command in this file
const run = (cmd: any, input: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(cmd, input as never, ctx, ports) as Promise<Record<string, unknown> & { id: string }>;
const publicCtx = (orgId: string) => createCtx({ orgId });
const voter = (n: number) => n.toString(16).padStart(64, '0');
const unique = `k${Date.now().toString(36)}`;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  marketerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: marketerId, role: 'marketing' }, a.ctx(), ports);
  organizers = (await run(createHelpCategoryCommand, {
    audience: 'organizers',
    title: 'Selling Tickets',
    translations: { ar: { title: 'بيع التذاكر', description: null } },
    position: 1,
  })) as unknown as HelpCategoryDto;
  buyers = (await run(createHelpCategoryCommand, {
    audience: 'buyers',
    title: 'Your tickets',
    position: 2,
  })) as unknown as HelpCategoryDto;
});
afterAll(closePools);

describe('help center CMS (M3.11b)', () => {
  it('categories: derived slug with a suffix on a clash; "search" is reserved; translations validated', async () => {
    expect(organizers.slug).toBe('selling-tickets');
    const again = await run(createHelpCategoryCommand, { audience: 'organizers', title: 'Selling tickets!' });
    expect(again.slug).toBe('selling-tickets-2');
    expect((await run(createHelpCategoryCommand, { audience: 'buyers', title: 'Search' })).slug).toBe(
      'search-2',
    );
    await expect(
      run(createHelpCategoryCommand, { audience: 'buyers', title: 'X', slug: 'search' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'reserved' },
    });
    await expect(
      run(createHelpCategoryCommand, {
        audience: 'buyers',
        title: 'X',
        translations: { xx: { title: 'y' } },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await run(deleteHelpCategoryCommand, { categoryId: again.id });
  });

  it('drafts are never public; publishing shows the article; unpublish and archive hide it again', async () => {
    const art = await run(createHelpArticleCommand, {
      categoryId: organizers.id,
      title: `Refund an order ${unique}`,
      summary: 'Money back for buyers',
      body: `Refunds ${unique}\u0000 <script>x</script>`,
      keywords: 'refund, money back',
    });
    expect(art).toMatchObject({ status: 'draft', publishedAt: null, locale: 'en' });
    expect(art.body).toBe(`Refunds ${unique} <script>x</script>`);
    const slug = art.slug as string;
    const visible = async () =>
      (await publicHelpCenter(a.org.id, 'en')).articles.some((x) => x.slug === slug);
    expect(await visible()).toBe(false);
    expect(await publicHelpArticle(a.org.id, 'en', slug)).toBeNull();
    expect((await publicHelpSearchDocs(a.org.id, 'en')).some((d) => d.slug === slug)).toBe(false);

    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'publish' });
    expect(await visible()).toBe(true);
    const found = await publicHelpArticle(a.org.id, 'en', slug);
    expect(found?.article).toMatchObject({
      slug,
      categorySlug: 'selling-tickets',
      locale: 'en',
      locales: ['en'],
    });
    // Allowlisted: no ids, no status.
    expect(Object.keys(found?.article ?? {})).not.toContain('id');
    expect(Object.keys(found?.article ?? {})).not.toContain('status');
    const center = await publicHelpCenter(a.org.id, 'en');
    expect(center.categories.find((c) => c.slug === 'selling-tickets')?.articleCount).toBeGreaterThanOrEqual(
      1,
    );
    // A category without published articles is not listed.
    expect(center.categories.some((c) => c.slug === buyers.slug)).toBe(false);
    // Search finds it (title first).
    const docs = await publicHelpSearchDocs(a.org.id, 'en');
    expect(rankArticles(`refund ${unique}`, docs)[0]?.doc.slug).toBe(slug);
    // The sitemap lists it and its category.
    const map = await helpSitemapEntries(a.org.id);
    expect(map.articles.some((x) => x.slug === slug && x.categorySlug === 'selling-tickets')).toBe(true);
    expect(map.categories.some((c) => c.slug === 'selling-tickets')).toBe(true);

    // The address is frozen once published.
    await expect(
      run(updateHelpArticleCommand, { articleId: art.id, slug: 'other-address' }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'frozen' },
    });
    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'unpublish' });
    expect(await visible()).toBe(false);
    expect((await helpSitemapEntries(a.org.id)).articles.some((x) => x.slug === slug)).toBe(false);
    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'publish' });
    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'archive' });
    expect(await publicHelpArticle(a.org.id, 'en', slug)).toBeNull();
    await expect(
      run(setHelpArticleStatusCommand, { articleId: art.id, action: 'unpublish' }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('translations: the reader’s locale, English where not translated; category names translated', async () => {
    const en = await run(createHelpArticleCommand, {
      categoryId: buyers.id,
      title: 'Find your tickets',
      slug: `find-${unique}`,
      body: 'English text',
    });
    const ar = await run(createHelpArticleCommand, {
      categoryId: buyers.id,
      locale: 'ar',
      slug: `find-${unique}`,
      title: 'العثور على تذاكرك',
      body: 'نص عربي',
    });
    const other = await run(createHelpArticleCommand, {
      categoryId: organizers.id,
      title: `Only English ${unique}`,
    });
    for (const x of [en, ar, other])
      await run(setHelpArticleStatusCommand, { articleId: x.id, action: 'publish' });
    // Same slug, same locale is refused.
    await expect(
      run(createHelpArticleCommand, {
        categoryId: buyers.id,
        locale: 'ar',
        slug: `find-${unique}`,
        title: 'x',
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'taken' } });

    const inArabic = await publicHelpArticle(a.org.id, 'ar', `find-${unique}`);
    expect(inArabic?.article).toMatchObject({
      locale: 'ar',
      title: 'العثور على تذاكرك',
      locales: ['ar', 'en'],
    });
    expect((await publicHelpArticle(a.org.id, 'de', `find-${unique}`))?.article.locale).toBe('en');
    expect((await publicHelpArticle(a.org.id, 'ar', other.slug as string))?.article.locale).toBe('en');
    const center = await publicHelpCenter(a.org.id, 'ar');
    // One entry per slug (the Arabic one), not both.
    expect(center.articles.filter((x) => x.slug === `find-${unique}`).map((x) => x.locale)).toEqual(['ar']);
    expect(center.categories.find((c) => c.slug === 'selling-tickets')).toMatchObject({
      title: 'بيع التذاكر',
      locale: 'ar',
    });
    expect(center.categories.find((c) => c.slug === buyers.slug)).toMatchObject({
      title: 'Your tickets',
      locale: 'en',
    });
  });

  it('permissions: viewers read only; marketing writes; a category of another org is unknown', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listHelpQuery, {}, viewer, ports)).categories.length).toBeGreaterThan(0);
    await expect(
      run(createHelpCategoryCommand, { audience: 'buyers', title: 'V' }, viewer),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(createHelpArticleCommand, { categoryId: organizers.id, title: 'V' }, viewer),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const marketer = userCtx(marketerId, a.org.id);
    const m = await run(
      createHelpArticleCommand,
      { categoryId: organizers.id, title: 'Marketing wrote this' },
      marketer,
    );
    await run(updateHelpCategoryCommand, { categoryId: organizers.id, position: 3 }, marketer);
    // Org B can't file an article under A's category, nor see or change A's article.
    await expect(
      run(createHelpArticleCommand, { categoryId: organizers.id, title: 'Sneaky' }, b.ctx()),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { issues: [{ path: 'categoryId' }] } });
    await expect(
      run(setHelpArticleStatusCommand, { articleId: m.id, action: 'publish' }, b.ctx()),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(run(deleteHelpArticleCommand, { articleId: m.id }, b.ctx())).rejects.toMatchObject({
      code: 'not_found',
    });
    // B's public help center never shows A's content.
    expect(
      (await publicHelpCenter(b.org.id, 'en')).categories.some((c) => c.slug === 'selling-tickets'),
    ).toBe(false);
    await run(deleteHelpArticleCommand, { articleId: m.id });
  });

  it('a category with articles cannot be deleted', async () => {
    await expect(run(deleteHelpCategoryCommand, { categoryId: organizers.id })).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'has_articles' },
    });
  });

  it('every write is audited and publishing emits cms.help_article_published@1', async () => {
    const art = await run(createHelpArticleCommand, {
      categoryId: organizers.id,
      title: `Audited ${unique}`,
    });
    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'publish' });
    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id = ${art.id} order by seq`,
      ),
    );
    expect(audit.map((r) => r.action)).toEqual(['cms.help_article.create', 'cms.help_article.publish']);
    const events = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ type: string; version: number }>(
        sql`select type, version from platform.domain_events where aggregate_id = ${art.id} order by created_at`,
      ),
    );
    expect(events.map((e) => `${e.type}@${e.version}`)).toEqual([
      'cms.help_article_created@1',
      'cms.help_article_published@1',
    ]);
  });
});

describe('"was this helpful?" (M3.11b)', () => {
  let slug: string;
  beforeAll(async () => {
    const art = await run(createHelpArticleCommand, {
      categoryId: organizers.id,
      title: `Feedback target ${unique}`,
    });
    await run(setHelpArticleStatusCommand, { articleId: art.id, action: 'publish' });
    slug = art.slug as string;
  });
  const answer = (helpful: boolean, v: number, extra: Record<string, unknown> = {}, orgId = a.org.id) =>
    executeCommand(
      submitHelpFeedbackCommand,
      { slug, locale: 'en', helpful, voterKey: voter(v), ...extra } as never,
      publicCtx(orgId),
      ports,
    );
  const counts = async () => {
    const { articles } = await executeQuery(listHelpQuery, {}, a.ctx(), ports);
    const row = articles.find((x) => x.slug === slug);
    return [row?.helpfulYes, row?.helpfulNo];
  };

  it('one answer per browser per article: answering again replaces it; a reason only with "no"', async () => {
    await answer(true, 1);
    await answer(true, 2);
    expect(await counts()).toEqual([2, 0]);
    await answer(false, 1, { reason: 'outdated' });
    expect(await counts()).toEqual([1, 1]);
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ reason: string | null }>(
        sql`select reason from cms.help_feedback where voter_key = ${voter(1)} and article_id in (select id from cms.help_articles where slug = ${slug})`,
      ),
    );
    expect(row?.reason).toBe('outdated');
    // "Yes" with a reason stores no reason.
    await answer(true, 3, { reason: 'unclear' });
    expect(await counts()).toEqual([2, 1]);
  });

  it('refuses drafts, unknown articles, other orgs, and malformed voter keys', async () => {
    const draft = await run(createHelpArticleCommand, {
      categoryId: organizers.id,
      title: `Draft fb ${unique}`,
    });
    await expect(
      executeCommand(
        submitHelpFeedbackCommand,
        { slug: draft.slug as string, locale: 'en', helpful: true, voterKey: voter(9) },
        publicCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(answer(true, 9, {}, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(answer(true, 9, { voterKey: 'not-a-hash' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('rate limit (Postgres store): 20 answers per device in 10 minutes, then Retry-After; other devices unaffected', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const device = `fbdevice${unique}`.padEnd(20, 'x');
    const now = Date.now();
    const limit = RATE_LIMIT_POLICIES.helpFeedback.device.limit;
    for (let i = 0; i < limit; i++)
      expect((await rl.check('helpFeedback', { device }, { now })).allowed).toBe(true);
    const denied = await rl.check('helpFeedback', { device }, { now });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect((await rl.check('helpFeedback', { device: `${device}y` }, { now })).allowed).toBe(true);
    // Two windows later the count has aged out.
    expect((await rl.check('helpFeedback', { device }, { now: now + 20 * 60_000 + 1 })).allowed).toBe(true);
  });
});

describe('marketing sections (M3.11b)', () => {
  it('only published sections, in order, with the English fallback per section', async () => {
    const mk = (input: Record<string, unknown>) =>
      run(createSiteSectionCommand, { placement: 'features', ...input });
    const s1 = await mk({ heading: `Tickets ${unique}`, slug: `tickets-${unique}`, position: 2 });
    const s2 = await mk({ heading: `Seating ${unique}`, slug: `seating-${unique}`, position: 1 });
    const s1ar = await mk({ heading: 'التذاكر', slug: `tickets-${unique}`, locale: 'ar', position: 2 });
    const draft = await mk({ heading: `Secret ${unique}`, slug: `secret-${unique}`, position: 0 });
    for (const s of [s1, s2, s1ar])
      await run(setSiteSectionStatusCommand, { sectionId: s.id, action: 'publish' });
    const mine = <T extends { slug: string }>(list: T[]) => list.filter((x) => x.slug.endsWith(unique));
    expect(mine(await publicSiteSections(a.org.id, 'features', 'en')).map((x) => x.slug)).toEqual([
      `seating-${unique}`,
      `tickets-${unique}`,
    ]);
    const ar = mine(await publicSiteSections(a.org.id, 'features', 'ar'));
    expect(ar.map((x) => [x.slug, x.locale])).toEqual([
      [`seating-${unique}`, 'en'],
      [`tickets-${unique}`, 'ar'],
    ]);
    expect(JSON.stringify(await publicSiteSections(a.org.id, 'features', 'en'))).not.toContain(
      `Secret ${unique}`,
    );
    expect(JSON.stringify(await publicSiteSections(a.org.id, 'home', 'en'))).not.toContain(unique);
    // Other orgs see none of it.
    expect(JSON.stringify(await publicSiteSections(b.org.id, 'features', 'en'))).not.toContain(unique);
    // Unpublishing hides it.
    await run(setSiteSectionStatusCommand, { sectionId: s2.id, action: 'unpublish' });
    expect(mine(await publicSiteSections(a.org.id, 'features', 'en')).map((x) => x.slug)).toEqual([
      `tickets-${unique}`,
    ]);
    // Viewers can't publish.
    await expect(
      run(
        setSiteSectionStatusCommand,
        { sectionId: draft.id, action: 'publish' },
        userCtx(a.viewerId, a.org.id),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('call to action: label and link together; a site path or https only', async () => {
    const base = { placement: 'home', heading: `CTA ${unique}` };
    await expect(run(createSiteSectionCommand, { ...base, ctaLabel: 'Go' })).rejects.toMatchObject({
      details: { issues: [{ path: 'ctaHref', code: 'required' }] },
    });
    for (const href of ['javascript:alert(1)', '//evil.test', 'http://x.test'])
      await expect(
        run(createSiteSectionCommand, { ...base, ctaLabel: 'Go', ctaHref: href }),
      ).rejects.toMatchObject({
        details: { issues: [{ path: 'ctaHref', code: 'format' }] },
      });
    const ok = await run(createSiteSectionCommand, { ...base, ctaLabel: 'Go', ctaHref: '/features' });
    await expect(
      run(updateSiteSectionCommand, { sectionId: ok.id, ctaHref: 'data:text/html,x' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // Clearing both is fine.
    await run(updateSiteSectionCommand, { sectionId: ok.id, ctaLabel: '', ctaHref: '' });
  });
});

describe('contact requests (M3.11b)', () => {
  it('stored for the org’s writers only; the event carries no personal data; handled once', async () => {
    const email = `buyer-${unique}@example.test`;
    await executeCommand(
      submitContactRequestCommand,
      { topic: 'sales', name: 'Pat Buyer', email: email.toUpperCase(), message: 'We run 40 events a year.' },
      publicCtx(a.org.id),
      ports,
    );
    const list = await executeQuery(listContactRequestsQuery, {}, a.ctx(), ports);
    const mine = list.find((r) => r.email === email);
    expect(mine).toMatchObject({ topic: 'sales', name: 'Pat Buyer', status: 'new' });
    await expect(
      executeQuery(listContactRequestsQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      (await executeQuery(listContactRequestsQuery, {}, b.ctx(), ports)).some((r) => r.email === email),
    ).toBe(false);
    const [event] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ type: string; payload: unknown }>(
        sql`select type, payload from platform.domain_events where aggregate_id = ${mine?.id ?? ''}`,
      ),
    );
    expect(event?.type).toBe('cms.contact_requested');
    expect(JSON.stringify(event?.payload)).not.toContain('example.test');
    expect(JSON.stringify(event?.payload)).not.toContain('Pat');
    await executeCommand(markContactHandledCommand, { requestId: mine?.id ?? '' }, a.ctx(), ports);
    await executeCommand(markContactHandledCommand, { requestId: mine?.id ?? '' }, a.ctx(), ports);
    expect(
      (await executeQuery(listContactRequestsQuery, { status: 'handled' }, a.ctx(), ports)).some(
        (r) => r.email === email,
      ),
    ).toBe(true);
    await expect(
      executeCommand(markContactHandledCommand, { requestId: mine?.id ?? '' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates the message and the address', async () => {
    const send = (input: Record<string, unknown>) =>
      executeCommand(
        submitContactRequestCommand,
        {
          topic: 'support',
          name: 'X',
          email: 'x@example.test',
          message: 'Long enough text',
          ...input,
        } as never,
        publicCtx(a.org.id),
        ports,
      );
    await expect(send({ message: 'short' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(send({ email: 'not-an-email' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(send({ topic: 'spam' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(send({ name: '' })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rate limit (Postgres store): 3 per sender address an hour across devices', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const identity = `limit-${unique}@example.test`;
    const now = Date.now();
    for (let i = 0; i < 3; i++)
      expect(
        (
          await rl.check(
            'contactRequest',
            { device: `contactdevice${i}${unique}`.padEnd(20, 'x'), identity },
            { now },
          )
        ).allowed,
      ).toBe(true);
    expect(
      (
        await rl.check(
          'contactRequest',
          { device: `contactdevice9${unique}`.padEnd(20, 'x'), identity },
          { now },
        )
      ).allowed,
    ).toBe(false);
  });
});
