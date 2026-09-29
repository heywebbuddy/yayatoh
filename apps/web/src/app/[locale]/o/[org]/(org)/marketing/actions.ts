'use server';

import {
  createSiteSectionCommand,
  deleteSiteSectionCommand,
  markContactHandledCommand,
  setSiteSectionStatusCommand,
  updateSiteSectionCommand,
} from '@yayatoh/cms';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath, updateTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation.ts';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

async function contentConsole(org: string) {
  if (!isPlatformContentOrg(org)) notFound();
  return loadConsole(org);
}

function refresh(org: string, orgId: string) {
  for (const tag of orgChangeTags(orgId)) updateTag(tag);
  revalidatePath(`/o/${org}/marketing`, 'layout');
}

function fields(form: FormData) {
  const pos = text(form, 'position').trim();
  return {
    slug: text(form, 'slug').trim(),
    eyebrow: text(form, 'eyebrow'),
    heading: text(form, 'heading'),
    body: text(form, 'body'),
    ctaLabel: text(form, 'ctaLabel'),
    ctaHref: text(form, 'ctaHref').trim(),
    position: pos === '' ? 0 : Number(pos),
  };
}

export async function createSectionAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await contentConsole(org);
  let id: string;
  try {
    const f = fields(form);
    const row = await executeCommand(
      createSiteSectionCommand,
      {
        ...f,
        slug: f.slug || undefined,
        placement: text(form, 'placement') as never,
        locale: text(form, 'locale') as never,
      },
      data.ctx,
      ports,
    );
    id = row.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/marketing`);
  return redirect({ href: `/o/${org}/marketing/${id}?created=1`, locale: data.ctx.locale ?? 'en' });
}

export async function updateSectionAction(
  org: string,
  sectionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(updateSiteSectionCommand, { sectionId, ...fields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return success();
}

export async function sectionStatusAction(
  org: string,
  sectionId: string,
  action: 'publish' | 'unpublish' | 'archive',
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(setSiteSectionStatusCommand, { sectionId, action }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return success();
}

export async function deleteSectionAction(
  org: string,
  sectionId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(deleteSiteSectionCommand, { sectionId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return redirect({ href: `/o/${org}/marketing?deleted=1`, locale: data.ctx.locale ?? 'en' });
}

export async function markHandledAction(org: string, requestId: string, _form: FormData): Promise<void> {
  const data = await contentConsole(org);
  await executeCommand(markContactHandledCommand, { requestId }, data.ctx, ports);
  revalidatePath(`/o/${org}/marketing`);
}
