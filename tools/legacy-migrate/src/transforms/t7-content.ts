import { cmsSlug, nextFreeSlug } from '@yayatoh/cms';
import { htmlToMarkdown, plainLine } from '../content.ts';
import { detUuid, legacyKey } from '../ids.ts';
import {
  type Finding,
  hasColumn,
  hasTable,
  insertRows,
  recordExceptions,
  recordQuarantine,
  recordRefs,
  rows,
  type StepContext,
} from './context.ts';
import { platformOrg } from './t6-comms.ts';

/** The CMS body limit (`cms.entries_body_check`). */
export const CMS_BODY_MAX = 20_000;

interface LegacyEntry {
  id: string;
  author: string | null;
  org_id: string | null;
  title: string | null;
  excerpt: string | null;
  body: string | null;
  slug: string | null;
  seo_title: string | null;
  meta: string | null;
  status: string | null;
  created: Date | null;
  updated: Date | null;
}

/**
 * T7 content (roadmap §7.5: "Voyager content becomes per-org CMS; yayatoh.com goes to the platform
 * org; abc content goes to ABC"; M2.2d). Voyager `pages` → `cms.entries` pages (`/pages/{slug}`)
 * and `posts` → posts (`/blogs/{slug}`):
 * - owner: the org of the author when the author is a migrated organizer, else the instance's
 *   platform-level org (`yayatoh` for yay, ABC for abc);
 * - slug: the legacy slug in the CMS form (lowercase, hyphens), made unique within the org and
 *   kind; the legacy URL then redirects (URL inventory);
 * - body: legacy HTML → the Markdown subset (never injected), capped at 20,000 (listed when cut);
 * - status: ACTIVE / PUBLISHED → published (at the legacy creation time), anything else → draft;
 * - meta description → SEO description; the image is listed in the media manifest.
 * Rows without a title are quarantined. Idempotent: ids are derived, and an entry that exists is
 * never rewritten (an organizer may have edited it since).
 */
export async function t7Content(ctx: StepContext): Promise<void> {
  const platform = await platformOrg(ctx);
  for (const [table, kind] of [
    ['pages', 'page'],
    ['posts', 'post'],
  ] as const) {
    if (!(await hasTable(ctx, table))) continue;
    const col = async (c: string, fallback = 'null::text') =>
      (await hasColumn(ctx, table, c)) ? `p.${c}::text` : fallback;
    const src = await rows<LegacyEntry>(
      ctx,
      `select p.id::text as id, p.author_id::text as author, o.org_id, p.title, ${await col('excerpt')} as excerpt,
              p.body, p.slug, ${await col('seo_title')} as seo_title, ${await col('meta_description')} as meta, p.status::text as status,
              (p.created_at at time zone {tz}) as created, (p.updated_at at time zone {tz}) as updated
       from {s}.${table} p
       left join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = p.author_id::text
       order by p.id`,
    );
    const taken = new Map<string, Set<string>>();
    const existing = await ctx.sql<{ id: string; org_id: string; slug: string }[]>`
      select id, org_id, slug from cms.entries where kind = ${kind}`;
    const own = new Map(existing.map((e) => [e.id, e.slug]));
    for (const e of existing) taken.set(e.org_id, (taken.get(e.org_id) ?? new Set()).add(e.slug));
    const quarantine: Finding[] = [];
    const exceptions: Finding[] = [];
    const out: Record<string, unknown>[] = [];
    const refs: { legacyId: string; newId: string; orgId: string; compatId: number }[] = [];
    for (const p of src) {
      const title = plainLine(p.title, 160);
      if (!title) {
        quarantine.push({ legacyId: p.id, kind: 'title_missing', detail: { column: 'title' } });
        continue;
      }
      const orgId = p.org_id ?? platform;
      const id = detUuid(p.created, legacyKey(ctx.instance, table, p.id));
      refs.push({ legacyId: p.id, newId: id, orgId, compatId: Number(p.id) });
      const legacySlug = (p.slug ?? '').trim().toLowerCase();
      const set = taken.get(orgId) ?? new Set<string>();
      // Migrated before: the entry keeps its slug and is never rewritten (listed again).
      const slug = own.get(id) ?? nextFreeSlug(cmsSlug(legacySlug || title), set);
      set.add(slug);
      taken.set(orgId, set);
      if (slug !== legacySlug)
        exceptions.push({ legacyId: p.id, kind: 'cms_slug_changed', detail: { from: p.slug, to: slug } });
      if (!p.org_id)
        exceptions.push({ legacyId: p.id, kind: 'cms_platform_content', detail: { author: p.author } });
      if (own.has(id)) continue;
      const full = htmlToMarkdown(p.body, CMS_BODY_MAX + 1);
      if (full.length > CMS_BODY_MAX)
        exceptions.push({ legacyId: p.id, kind: 'cms_body_truncated', detail: { chars: CMS_BODY_MAX } });
      const status = (p.status ?? '').trim().toUpperCase();
      const published = status === 'ACTIVE' || status === 'PUBLISHED';
      const created = p.created ?? '1970-01-01T00:00:00Z';
      out.push({
        id,
        org_id: orgId,
        kind,
        slug,
        title,
        excerpt: plainLine(p.excerpt, 300) || null,
        body: full.slice(0, CMS_BODY_MAX).trim(),
        status: published ? 'published' : 'draft',
        published_at: published ? created : null,
        seo_title: plainLine(p.seo_title, 70) || null,
        seo_description: plainLine(p.meta, 160) || null,
        author_user_id: null,
        author_name: null,
        created_at: created,
        updated_at: p.updated ?? created,
      });
    }
    await insertRows(ctx, 'cms.entries', out);
    await recordRefs(ctx, table, refs);
    await recordQuarantine(ctx, table, quarantine);
    await recordExceptions(ctx, table, exceptions);
  }
}
