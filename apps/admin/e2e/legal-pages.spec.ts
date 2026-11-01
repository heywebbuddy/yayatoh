import { expect, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { getPage, savePage } from '../src/server/platform-site.ts';
import { WEB } from './helpers.ts';

const ACTOR = 'staff:e2e';

test.afterAll(async () => {
  await closePools();
});

/** Terms, Privacy and Refund policy are site pages: staff edit them, the public site follows at once. */
test.describe('legal pages from the site-pages store', () => {
  test('terms, privacy and refund policy render from the store', async ({ request }) => {
    for (const [path, heading] of [
      ['/terms', 'Terms of service'],
      ['/privacy', 'Privacy notice'],
      ['/refund-policy', 'Refund policy'],
    ] as const) {
      const res = await request.get(`${WEB}${path}`);
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).toContain(heading);
    }
  });

  test('an edit, a per-language version and unpublishing show on the public page without a redeploy', async ({
    request,
  }) => {
    test.skip(test.info().project.name !== 'desktop-1280', 'one project edits the single global page');
    setPlatformAuditSink(databaseAuditSink);
    const original = await getPage(ACTOR, 'refund-policy', 'en');
    expect(original, 'the refund policy page is seeded by migration 0196').not.toBeNull();
    if (!original) return;
    const base = {
      slug: 'refund-policy',
      effectiveDate: original.effectiveDate,
      body: '## Marker\n\nRefund marker text.',
    };
    try {
      await savePage(ACTOR, { ...base, locale: 'en', title: 'Refund policy E2E', status: 'published' });
      let res = await request.get(`${WEB}/refund-policy`);
      expect(await res.text()).toContain('Refund policy E2E');

      // A draft hides the page; the French version is separate from the English one.
      await savePage(ACTOR, { ...base, locale: 'en', title: 'Refund policy E2E', status: 'draft' });
      expect((await request.get(`${WEB}/refund-policy`)).status()).toBe(404);
      await savePage(ACTOR, { ...base, locale: 'fr', title: 'Politique E2E', status: 'published' });
      res = await request.get(`${WEB}/fr/refund-policy`);
      expect(await res.text()).toContain('Politique E2E');
    } finally {
      await savePage(ACTOR, {
        slug: 'refund-policy',
        locale: 'en',
        title: original.title,
        body: original.body,
        effectiveDate: original.effectiveDate,
        status: original.status,
      });
      await savePage(ACTOR, { ...base, locale: 'fr', title: 'Politique E2E', status: 'draft' });
    }
  });
});
