'use server';

import { draftPage, PageDraftDto as PageDraft, type PageDraftDto } from '@yayatoh/ai';
import {
  createEntryCommand,
  deleteEntryCommand,
  EntryKind,
  setEntryStatusCommand,
  updateEntryCommand,
} from '@yayatoh/cms';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath, updateTag } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall, composeArgs } from '@/server/ai-compose.ts';
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

/** M6.12b: draft a page or post with AI (a preview; nothing is saved until "Create draft"). */
export async function draftPageAiAction(
  org: string,
  values: unknown,
): Promise<AiComposeResult<PageDraftDto>> {
  const data = await loadConsole(org);
  const v = composeArgs(values);
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: 'page' }, async () => {
    const res = await draftPage(data.ctx, ports, aiDrafter(), { ...v, locale: await getLocale() });
    return { value: res.draft, balance: res.balance };
  });
}

/**
 * M6.12b: keep an AI draft as a new **draft** entry (never published) and open it in the editor,
 * where the organizer edits it like any other.
 */
export async function createFromAiDraftAction(org: string, kind: string, draft: unknown): Promise<FormState> {
  const data = await loadConsole(org);
  const d = PageDraft.safeParse(draft);
  if (!d.success) return { ok: false, code: 'validation_failed', fields: ['body'] };
  let id: string;
  try {
    const row = await executeCommand(
      createEntryCommand,
      {
        title: d.data.title,
        excerpt: d.data.excerpt,
        body: d.data.body,
        seoTitle: '',
        seoDescription: '',
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
