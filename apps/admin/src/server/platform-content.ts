import { createHash } from 'node:crypto';
import { sanitizeMarkdown } from '@yayatoh/contracts';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Platform content (blog, testimonials, home hero) managed by staff. Every read and write goes
 * through platform_reader, so each use lands in the access log with the staff actor and a reason
 * naming what changed. Writes call the SECURITY DEFINER `cms.platform_*` functions.
 */
type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const read = <T>(
  actor: string,
  reason: string,
  fn: (tx: Parameters<Parameters<typeof withPlatformReader>[1]>[0]) => Promise<T>,
) => withPlatformReader({ actor, reason: `staff console: ${reason}` }, fn);
const write = <T>(
  actor: string,
  reason: string,
  fn: (tx: Parameters<Parameters<typeof withPlatformReader>[1]>[0]) => Promise<T>,
) => withPlatformReader({ actor, reason: `staff console: ${reason}` }, fn, { callsWritingFunctions: true });

export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

/* ------------------------------------------------------------------------------ assets ---- */

const IMAGE_MAX = 5 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;

/** What a file really is, from its first bytes (never from the name or claimed type). */
export function sniffAsset(b: Uint8Array): { kind: 'image' | 'video'; type: string } | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', type: 'image/jpeg' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', type: 'image/png' };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return { kind: 'image', type: 'image/webp' };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return { kind: 'video', type: 'video/mp4' };
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', type: 'video/webm' };
  return null;
}

export class AssetRefused extends Error {
  constructor(readonly reason: 'empty' | 'type' | 'too_large' | 'not_image' | 'not_video') {
    super(reason);
  }
}

/** Store an uploaded image or video; returns its id. */
export async function storeAsset(actor: string, bytes: Uint8Array, want: 'image' | 'video'): Promise<string> {
  if (bytes.byteLength === 0) throw new AssetRefused('empty');
  const found = sniffAsset(bytes);
  if (!found) throw new AssetRefused('type');
  if (found.kind !== want) throw new AssetRefused(want === 'image' ? 'not_image' : 'not_video');
  if (bytes.byteLength > (want === 'image' ? IMAGE_MAX : VIDEO_MAX)) throw new AssetRefused('too_large');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [row] = await write(actor, `upload ${found.kind} (${bytes.byteLength} bytes)`, (tx) =>
    tx.execute<{ id: string }>(
      sql`select cms.platform_store_asset(${found.kind}, ${found.type}, ${Buffer.from(bytes)}::bytea, ${sha}, ${actor}) as id`,
    ),
  );
  return String(row?.id);
}

export async function readAsset(actor: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await read(actor, `preview asset ${id}`, (tx) =>
    tx.execute<{ content_type: string; bytes: Uint8Array }>(
      sql`select content_type, bytes from cms.platform_assets where id = ${id}::uuid`,
    ),
  );
  return row ? { contentType: row.content_type, bytes: new Uint8Array(row.bytes) } : null;
}

/* -------------------------------------------------------------------------------- posts ---- */

export interface PostRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly body: string;
  readonly coverAssetId: string | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly status: 'draft' | 'published';
  readonly publishedAt: Date | null;
  readonly authorName: string | null;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

const toPost = (r: Row): PostRow => ({
  id: String(r.id),
  slug: String(r.slug),
  title: String(r.title),
  excerpt: String(r.excerpt ?? ''),
  body: String(r.body ?? ''),
  coverAssetId: str(r.cover_asset_id),
  seoTitle: str(r.seo_title),
  seoDescription: str(r.seo_description),
  status: r.status === 'published' ? 'published' : 'draft',
  publishedAt: r.published_at ? new Date(String(r.published_at)) : null,
  authorName: str(r.author_name),
  updatedAt: new Date(String(r.updated_at)),
  updatedBy: String(r.updated_by),
});

export async function listPosts(actor: string): Promise<PostRow[]> {
  const rows = await read(actor, 'list platform blog posts', (tx) =>
    tx.execute<Row>(sql`select * from cms.platform_posts order by updated_at desc`),
  );
  return rows.map(toPost);
}

export async function getPost(actor: string, id: string): Promise<PostRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await read(actor, `open platform blog post ${id}`, (tx) =>
    tx.execute<Row>(sql`select * from cms.platform_posts where id = ${id}::uuid`),
  );
  return rows[0] ? toPost(rows[0]) : null;
}

const text = (max: number) => z.string().trim().max(max);
export const PostInput = z.object({
  id: z.uuid().nullable(),
  title: text(160).min(1),
  slug: text(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  excerpt: text(400),
  body: z.string().max(50_000),
  coverAssetId: z.uuid().nullable(),
  seoTitle: text(70).nullable(),
  seoDescription: text(200).nullable(),
  status: z.enum(['draft', 'published']),
  authorName: text(120).nullable(),
});
export type PostInput = z.infer<typeof PostInput>;

/** Create or update a post; the Markdown body is sanitized (raw HTML stays text). */
export async function savePost(actor: string, input: PostInput): Promise<string> {
  const body = sanitizeMarkdown(input.body, 50_000);
  const payload = JSON.stringify({ ...input, body });
  const [row] = await write(
    actor,
    `${input.id ? 'update' : 'create'} platform blog post "${input.slug}" (${input.status})`,
    (tx) => tx.execute<{ id: string }>(sql`select cms.platform_save_post(${payload}::jsonb, ${actor}) as id`),
  );
  return String(row?.id);
}

export async function deletePost(actor: string, id: string): Promise<boolean> {
  const [row] = await write(actor, `delete platform blog post ${id}`, (tx) =>
    tx.execute<{ ok: boolean }>(sql`select cms.platform_delete_post(${id}::uuid, ${actor}) as ok`),
  );
  return Boolean(row?.ok);
}

/* ------------------------------------------------------------------------- testimonials ---- */

export interface TestimonialRow {
  readonly id: string;
  readonly quote: string;
  readonly name: string;
  readonly role: string | null;
  readonly photoAssetId: string | null;
  readonly rating: number | null;
  readonly position: number;
  readonly published: boolean;
}

export async function listTestimonials(actor: string): Promise<TestimonialRow[]> {
  const rows = await read(actor, 'list platform testimonials', (tx) =>
    tx.execute<Row>(sql`select * from cms.platform_testimonials order by position, created_at`),
  );
  return rows.map((r) => ({
    id: String(r.id),
    quote: String(r.quote),
    name: String(r.name),
    role: str(r.role),
    photoAssetId: str(r.photo_asset_id),
    rating: r.rating === null ? null : Number(r.rating),
    position: Number(r.position),
    published: Boolean(r.published),
  }));
}

export const TestimonialInput = z.object({
  id: z.uuid().nullable(),
  quote: text(600).min(1),
  name: text(120).min(1),
  role: text(160).nullable(),
  photoAssetId: z.uuid().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  position: z.number().int().min(0).max(9999),
  published: z.boolean(),
});
export type TestimonialInput = z.infer<typeof TestimonialInput>;

export async function saveTestimonial(actor: string, input: TestimonialInput): Promise<string> {
  const payload = JSON.stringify(input);
  const [row] = await write(
    actor,
    `${input.id ? 'update' : 'create'} platform testimonial by "${input.name}" (${input.published ? 'published' : 'hidden'})`,
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select cms.platform_save_testimonial(${payload}::jsonb, ${actor}) as id`,
      ),
  );
  return String(row?.id);
}

export async function deleteTestimonial(actor: string, id: string): Promise<boolean> {
  const [row] = await write(actor, `delete platform testimonial ${id}`, (tx) =>
    tx.execute<{ ok: boolean }>(sql`select cms.platform_delete_testimonial(${id}::uuid, ${actor}) as ok`),
  );
  return Boolean(row?.ok);
}

/* ------------------------------------------------------------------------------- hero ---- */

export interface HeroRow {
  readonly headline: string | null;
  readonly subtitle: string | null;
  readonly imageAssetId: string | null;
  readonly videoAssetId: string | null;
  readonly videoUrl: string | null;
  readonly ctaLabel: string | null;
  readonly ctaHref: string | null;
}

export async function getHero(actor: string): Promise<HeroRow | null> {
  const rows = await read(actor, 'open platform home hero', (tx) =>
    tx.execute<Row>(sql`select * from cms.platform_hero`),
  );
  const r = rows[0];
  return r
    ? {
        headline: str(r.headline),
        subtitle: str(r.subtitle),
        imageAssetId: str(r.image_asset_id),
        videoAssetId: str(r.video_asset_id),
        videoUrl: str(r.video_url),
        ctaLabel: str(r.cta_label),
        ctaHref: str(r.cta_href),
      }
    : null;
}

export const HeroInput = z
  .object({
    headline: text(120).nullable(),
    subtitle: text(300).nullable(),
    imageAssetId: z.uuid().nullable(),
    videoAssetId: z.uuid().nullable(),
    videoUrl: text(500).nullable(),
    ctaLabel: text(60).nullable(),
    ctaHref: text(300).nullable(),
  })
  .refine((v) => (v.ctaLabel === null) === (v.ctaHref === null), { path: ['ctaLabel'] })
  .refine((v) => v.ctaHref === null || /^(\/(?!\/)|https:\/\/)/.test(v.ctaHref), { path: ['ctaHref'] })
  .refine((v) => v.videoUrl === null || isEmbeddable(v.videoUrl), { path: ['videoUrl'] });
export type HeroInput = z.infer<typeof HeroInput>;

/** YouTube and Vimeo links only (the privacy-friendly embeds the public CSP allows). */
function isEmbeddable(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    return (
      u.protocol === 'https:' &&
      [
        'youtube.com',
        'youtu.be',
        'youtube-nocookie.com',
        'm.youtube.com',
        'vimeo.com',
        'player.vimeo.com',
      ].includes(h)
    );
  } catch {
    return false;
  }
}

export async function saveHero(actor: string, input: HeroInput): Promise<void> {
  const payload = JSON.stringify(input);
  await write(actor, 'update platform home hero', (tx) =>
    tx.execute(sql`select cms.platform_save_hero(${payload}::jsonb, ${actor})`),
  );
}
