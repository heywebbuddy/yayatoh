'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  AboutSettings,
  CONTACT_STATUSES,
  ContactSettings,
  PageInput,
  replyToContactMessage,
  savePage,
  saveSetting,
  updateContactMessage,
} from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';

const s = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

/** The public site caches nothing for these pages, but the admin lists must refresh. */
export async function savePageAction(form: FormData) {
  const staff = await requireStaff('content');
  const slug = s(form, 'slug');
  const back = `/content/pages/${slug || 'new'}`;
  const parsed = PageInput.safeParse({
    slug,
    title: s(form, 'title'),
    body: String(form.get('body') ?? ''),
    effectiveDate: s(form, 'effectiveDate'),
    status: form.get('intent') === 'draft' ? 'draft' : 'published',
  });
  if (!parsed.success) redirect(`${back}?error=invalid`);
  await savePage(staff.actor, parsed.data);
  revalidatePath('/content/pages');
  redirect(
    `/content/pages/${parsed.data.slug}?done=${parsed.data.status === 'published' ? 'published' : 'saved'}`,
  );
}

export async function saveContactSettingsAction(form: FormData) {
  const staff = await requireStaff('content');
  const parsed = ContactSettings.safeParse({
    address: s(form, 'address'),
    phone: s(form, 'phone'),
    email: s(form, 'email'),
    supportEmail: s(form, 'supportEmail'),
    hours: s(form, 'hours'),
  });
  if (!parsed.success) redirect('/content/contact?error=invalid');
  await saveSetting(staff.actor, 'contact', parsed.data);
  redirect('/content/contact?done=saved');
}

/** Repeating rows are posted as `values.0.title`, `values.1.title`, …; empty rows are dropped. */
function rows<K extends string>(form: FormData, group: string, keys: readonly K[], count: number) {
  const out: Record<K, string>[] = [];
  for (let i = 0; i < count; i++) {
    const row = Object.fromEntries(keys.map((k) => [k, s(form, `${group}.${i}.${k}`)])) as Record<K, string>;
    if (keys.some((k) => row[k])) out.push(row);
  }
  return out;
}

export async function saveAboutAction(form: FormData) {
  const staff = await requireStaff('content');
  const parsed = AboutSettings.safeParse({
    lede: s(form, 'lede'),
    mission: s(form, 'mission'),
    story: s(form, 'story'),
    values: rows(form, 'values', ['title', 'text'], 8),
    attendees: s(form, 'attendees'),
    organizers: s(form, 'organizers'),
    team: rows(form, 'team', ['name', 'role', 'bio'], 12),
    stats: rows(form, 'stats', ['value', 'label'], 6),
    ctaTitle: s(form, 'ctaTitle'),
    ctaLabel: s(form, 'ctaLabel'),
    ctaHref: s(form, 'ctaHref'),
  });
  if (!parsed.success) redirect('/content/about?error=invalid');
  await saveSetting(staff.actor, 'about', parsed.data);
  redirect('/content/about?done=saved');
}

/* ------------------------------------------------------------------------ contact inbox ---- */

const guarded = async (id: string) => {
  if (!z.uuid().safeParse(id).success) redirect('/contact-messages');
  return requireStaff('content');
};

export async function updateMessageAction(id: string, form: FormData) {
  const staff = await guarded(id);
  const status = s(form, 'status');
  if (!(CONTACT_STATUSES as readonly string[]).includes(status))
    redirect(`/contact-messages/${id}?error=invalid`);
  await updateContactMessage(
    staff.actor,
    id,
    status as (typeof CONTACT_STATUSES)[number],
    String(form.get('notes') ?? ''),
  );
  revalidatePath('/contact-messages');
  redirect(`/contact-messages/${id}?done=saved`);
}

export async function replyMessageAction(id: string, form: FormData) {
  const staff = await guarded(id);
  const body = String(form.get('reply') ?? '').trim();
  if (!body) redirect(`/contact-messages/${id}?error=empty`);
  try {
    await replyToContactMessage(staff.actor, id, body);
  } catch {
    redirect(`/contact-messages/${id}?error=mail`);
  }
  revalidatePath('/contact-messages');
  redirect(`/contact-messages/${id}?done=replied`);
}
