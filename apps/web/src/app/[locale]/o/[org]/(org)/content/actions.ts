'use server';

import {
  createEntryCommand,
  deleteEntryCommand,
  EntryKind,
  setEntryStatusCommand,
  updateEntryCommand,
} from '@yayatoh/cms';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from '@/i18n/navigation.ts';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

function fields(form: FormData) {
  return {
    title: text(form, 'title'),
    slug: text(form, 'slug').trim(),
    excerpt: text(form, 'excerpt'),
    body: text(form, 'body'),
    seoTitle: text(form, 'seoTitle'),
    seoDescription: text(form, 'seoDescription'),
  };
}

/** Public pages of this org (tenant site, organizer page, marketplace) drop their cache. */
function refreshPublic(orgId: string) {
  for (const tag of orgChangeTags(orgId)) updateTag(tag);
}

export async function createEntryAction(
  org: string,
  kind: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  let id: string;
  try {
    const f = fields(form);
    const row = await executeCommand(
      createEntryCommand,
      {
        ...f,
        slug: f.slug || undefined,
        kind: EntryKind.parse(kind),
        authorName: data.session.name || null,
      },
      data.ctx,
      ports,
    );
    id = row.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/content`);
  return redirect({ href: `/o/${org}/content/${id}?created=1`, locale: data.ctx.locale ?? 'en' });
}

export async function updateEntryAction(
  org: string,
  entryId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    const f = fields(form);
    await executeCommand(updateEntryCommand, { entryId, ...f }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refreshPublic(data.org.id);
  revalidatePath(`/o/${org}/content`, 'layout');
  return success();
}

export async function entryStatusAction(
  org: string,
  entryId: string,
  action: 'publish' | 'unpublish' | 'archive',
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(setEntryStatusCommand, { entryId, action }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refreshPublic(data.org.id);
  revalidatePath(`/o/${org}/content`, 'layout');
  return success();
}

export async function deleteEntryAction(
  org: string,
  entryId: string,
  kind: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(deleteEntryCommand, { entryId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refreshPublic(data.org.id);
  revalidatePath(`/o/${org}/content`);
  return redirect({
    href: `/o/${org}/content?kind=${kind === 'page' ? 'page' : 'post'}&deleted=1`,
    locale: data.ctx.locale ?? 'en',
  });
}
