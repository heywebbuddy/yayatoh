import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/**
 * Public reads of the platform content staff manage in the admin console (blog, testimonials, the
 * home hero). They read only the `cms.public_platform_*` views: published rows, no ids of drafts,
 * no staff. Images and videos are served at `/api/platform-assets/{id}`.
 */
export const platformAssetUrl = (id: string | null) => (id ? `/api/platform-assets/${id}` : null);

export interface PlatformPostSummary {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly coverUrl: string | null;
  readonly publishedAt: Date;
}

export interface PlatformPost extends PlatformPostSummary {
  readonly body: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly authorName: string | null;
  readonly updatedAt: Date;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

const summary = (r: Row): PlatformPostSummary => ({
  slug: String(r.slug),
  title: String(r.title),
  excerpt: String(r.excerpt ?? ''),
  coverUrl: platformAssetUrl(text(r.cover_asset_id)),
  publishedAt: new Date(String(r.published_at)),
});

export async function platformPosts(
  limit = 12,
  offset = 0,
): Promise<{ items: PlatformPostSummary[]; total: number }> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(
      sql`select slug, title, excerpt, cover_asset_id, published_at, count(*) over ()::int as total
          from cms.public_platform_posts order by published_at desc, slug limit ${limit} offset ${offset}`,
    ),
  );
  return { items: rows.map(summary), total: Number(rows[0]?.total ?? 0) };
}

export async function platformPost(slug: string): Promise<PlatformPost | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from cms.public_platform_posts where slug = ${slug}`),
  );
  const r = rows[0];
  return r
    ? {
        ...summary(r),
        body: String(r.body ?? ''),
        seoTitle: text(r.seo_title),
        seoDescription: text(r.seo_description),
        authorName: text(r.author_name),
        updatedAt: new Date(String(r.updated_at)),
      }
    : null;
}

export interface PlatformTestimonial {
  readonly id: string;
  readonly quote: string;
  readonly name: string;
  readonly role: string | null;
  readonly photoUrl: string | null;
  readonly rating: number | null;
}

export async function platformTestimonials(): Promise<PlatformTestimonial[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from cms.public_platform_testimonials order by position, name`),
  );
  return rows.map((r) => ({
    id: String(r.id),
    quote: String(r.quote),
    name: String(r.name),
    role: text(r.role),
    photoUrl: platformAssetUrl(text(r.photo_asset_id)),
    rating: r.rating === null ? null : Number(r.rating),
  }));
}

export interface PlatformHero {
  readonly headline: string | null;
  readonly subtitle: string | null;
  readonly imageUrl: string | null;
  readonly videoFileUrl: string | null;
  readonly videoUrl: string | null;
  readonly ctaLabel: string | null;
  readonly ctaHref: string | null;
}

/** The staff-edited hero, or null when nothing was set (the built-in copy then shows). */
export async function platformHero(): Promise<PlatformHero | null> {
  const rows = await withoutTenant((tx) => tx.execute<Row>(sql`select * from cms.public_platform_hero`));
  const r = rows[0];
  if (!r) return null;
  return {
    headline: text(r.headline),
    subtitle: text(r.subtitle),
    imageUrl: platformAssetUrl(text(r.image_asset_id)),
    videoFileUrl: platformAssetUrl(text(r.video_asset_id)),
    videoUrl: text(r.video_url),
    ctaLabel: text(r.cta_label),
    ctaHref: text(r.cta_href),
  };
}

export async function platformAsset(
  id: string,
): Promise<{ contentType: string; bytes: Uint8Array; sha256: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ content_type: string; bytes: Uint8Array; sha256: string }>(
      sql`select content_type, bytes, sha256 from cms.public_platform_assets where id = ${id}::uuid`,
    ),
  );
  const r = rows[0];
  return r ? { contentType: r.content_type, bytes: new Uint8Array(r.bytes), sha256: r.sha256 } : null;
}
