'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AssetRefused,
  deletePost,
  deleteTestimonial,
  HeroInput,
  PostInput,
  saveHero,
  savePost,
  saveTestimonial,
  slugify,
  storeAsset,
  TestimonialInput,
} from '@/server/platform-content.ts';
import { requireStaff } from '@/server/staff.ts';

const s = (form: FormData, k: string) => String(form.get(k) ?? '').trim();
const orNull = (form: FormData, k: string) => s(form, k) || null;

/** An uploaded file (or the kept id) → asset id; a refused file redirects back with its reason. */
async function asset(
  actor: string,
  form: FormData,
  field: string,
  keep: string,
  want: 'image' | 'video',
  back: string,
): Promise<string | null> {
  if (form.get(`remove_${field}`) === '1') return null;
  const file = form.get(field);
  if (file instanceof File && file.size > 0) {
    try {
      return await storeAsset(actor, new Uint8Array(await file.arrayBuffer()), want);
    } catch (err) {
      if (err instanceof AssetRefused)
        redirect(`${back}${back.includes('?') ? '&' : '?'}error=${err.reason}`);
      throw err;
    }
  }
  return s(form, keep) || null;
}

const uuidOrNull = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/* ----------------------------------------------------------------------------- blog ---- */

/** Tags typed as a comma separated list. */
const tagList = (form: FormData) =>
  String(form.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

export async function savePostAction(form: FormData) {
  const staff = await requireStaff('content');
  const id = uuidOrNull(orNull(form, 'id'));
  const back = id ? `/content/blog/${id}` : '/content/blog/new';
  const cover = await asset(staff.actor, form, 'cover', 'coverAssetId', 'image', back);
  const title = s(form, 'title');
  const parsed = PostInput.safeParse({
    id,
    title,
    slug: s(form, 'slug') || slugify(title),
    excerpt: s(form, 'excerpt'),
    body: String(form.get('body') ?? ''),
    coverAssetId: uuidOrNull(cover),
    seoTitle: orNull(form, 'seoTitle'),
    seoDescription: orNull(form, 'seoDescription'),
    status: form.get('intent') === 'publish' ? 'published' : 'draft',
    authorName: orNull(form, 'authorName'),
    category: orNull(form, 'category'),
    tags: tagList(form),
    coverAlt: orNull(form, 'coverAlt'),
  });
  if (!parsed.success) redirect(`${back}?error=invalid`);
  let saved: string;
  try {
    saved = await savePost(staff.actor, parsed.data);
  } catch (err) {
    if (String(err).includes('platform_posts_slug_key')) redirect(`${back}?error=slug`);
    throw err;
  }
  revalidatePath('/content/blog');
  redirect(`/content/blog/${saved}?done=${parsed.data.status === 'published' ? 'published' : 'saved'}`);
}

export async function unpublishPostAction(form: FormData) {
  const staff = await requireStaff('content');
  const id = uuidOrNull(orNull(form, 'id'));
  if (!id) redirect('/content/blog');
  const parsed = PostInput.safeParse({
    id,
    title: s(form, 'title'),
    slug: s(form, 'slug'),
    excerpt: s(form, 'excerpt'),
    body: String(form.get('body') ?? ''),
    coverAssetId: uuidOrNull(orNull(form, 'coverAssetId')),
    seoTitle: orNull(form, 'seoTitle'),
    seoDescription: orNull(form, 'seoDescription'),
    status: 'draft',
    authorName: orNull(form, 'authorName'),
    category: orNull(form, 'category'),
    tags: tagList(form),
    coverAlt: orNull(form, 'coverAlt'),
  });
  if (!parsed.success) redirect(`/content/blog/${id}?error=invalid`);
  await savePost(staff.actor, parsed.data);
  revalidatePath('/content/blog');
  redirect(`/content/blog/${id}?done=unpublished`);
}

export async function deletePostAction(form: FormData) {
  const staff = await requireStaff('content');
  const id = uuidOrNull(orNull(form, 'id'));
  if (id) await deletePost(staff.actor, id);
  revalidatePath('/content/blog');
  redirect('/content/blog?done=deleted');
}

/* ------------------------------------------------------------------------ testimonials ---- */

export async function saveTestimonialAction(form: FormData) {
  const staff = await requireStaff('content');
  const id = uuidOrNull(orNull(form, 'id'));
  const photo = await asset(staff.actor, form, 'photo', 'photoAssetId', 'image', '/content/testimonials');
  const rating = Number.parseInt(s(form, 'rating'), 10);
  const parsed = TestimonialInput.safeParse({
    id,
    quote: s(form, 'quote'),
    name: s(form, 'name'),
    role: orNull(form, 'role'),
    photoAssetId: uuidOrNull(photo),
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    position: Number.parseInt(s(form, 'position'), 10) || 0,
    published: form.get('published') === '1',
  });
  if (!parsed.success) redirect('/content/testimonials?error=invalid');
  await saveTestimonial(staff.actor, parsed.data);
  revalidatePath('/content/testimonials');
  redirect('/content/testimonials?done=saved');
}

export async function deleteTestimonialAction(form: FormData) {
  const staff = await requireStaff('content');
  const id = uuidOrNull(orNull(form, 'id'));
  if (id) await deleteTestimonial(staff.actor, id);
  revalidatePath('/content/testimonials');
  redirect('/content/testimonials?done=deleted');
}

/* ---------------------------------------------------------------------------- hero ---- */

export async function saveHeroAction(form: FormData) {
  const staff = await requireStaff('content');
  const image = await asset(staff.actor, form, 'image', 'imageAssetId', 'image', '/content/hero');
  const video = await asset(staff.actor, form, 'video', 'videoAssetId', 'video', '/content/hero');
  const parsed = HeroInput.safeParse({
    headline: orNull(form, 'headline'),
    subtitle: orNull(form, 'subtitle'),
    imageAssetId: uuidOrNull(image),
    videoAssetId: uuidOrNull(video),
    videoUrl: orNull(form, 'videoUrl'),
    ctaLabel: orNull(form, 'ctaLabel'),
    ctaHref: orNull(form, 'ctaHref'),
  });
  if (!parsed.success) redirect('/content/hero?error=invalid');
  await saveHero(staff.actor, parsed.data);
  revalidatePath('/content/hero');
  redirect('/content/hero?done=saved');
}
