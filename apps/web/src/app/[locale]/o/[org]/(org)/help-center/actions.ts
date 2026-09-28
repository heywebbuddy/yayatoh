'use server';

import {
  createHelpArticleCommand,
  createHelpCategoryCommand,
  deleteHelpArticleCommand,
  deleteHelpCategoryCommand,
  setHelpArticleStatusCommand,
  updateHelpArticleCommand,
  updateHelpCategoryCommand,
} from '@yayatoh/cms';
import { LOCALES } from '@yayatoh/contracts';
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
const position = (form: FormData) => {
  const v = text(form, 'position').trim();
  return v === '' ? 0 : Number(v);
};

/** The help center is the content org's (M3.11b); any other org's console refuses these actions. */
async function contentConsole(org: string) {
  if (!isPlatformContentOrg(org)) notFound();
  return loadConsole(org);
}

function refresh(org: string, orgId: string) {
  for (const tag of orgChangeTags(orgId)) updateTag(tag);
  revalidatePath(`/o/${org}/help-center`, 'layout');
}

function articleFields(form: FormData) {
  return {
    categoryId: text(form, 'categoryId'),
    slug: text(form, 'slug').trim(),
    title: text(form, 'title'),
    summary: text(form, 'summary'),
    body: text(form, 'body'),
    keywords: text(form, 'keywords'),
    position: position(form),
    seoTitle: text(form, 'seoTitle'),
    seoDescription: text(form, 'seoDescription'),
  };
}

export async function createArticleAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await contentConsole(org);
  let id: string;
  try {
    const f = articleFields(form);
    const row = await executeCommand(
      createHelpArticleCommand,
      { ...f, slug: f.slug || undefined, locale: text(form, 'locale') as never },
      data.ctx,
      ports,
    );
    id = row.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/help-center`);
  return redirect({ href: `/o/${org}/help-center/${id}?created=1`, locale: data.ctx.locale ?? 'en' });
}

export async function updateArticleAction(
  org: string,
  articleId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(updateHelpArticleCommand, { articleId, ...articleFields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return success();
}

export async function articleStatusAction(
  org: string,
  articleId: string,
  action: 'publish' | 'unpublish' | 'archive',
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(setHelpArticleStatusCommand, { articleId, action }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return success();
}

export async function deleteArticleAction(
  org: string,
  articleId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(deleteHelpArticleCommand, { articleId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return redirect({ href: `/o/${org}/help-center?deleted=1`, locale: data.ctx.locale ?? 'en' });
}

/** Another locale's name and description, from `tr.{locale}.title` / `tr.{locale}.description`. */
function translations(form: FormData) {
  const out: Record<string, { title: string; description: string | null }> = {};
  for (const l of LOCALES) {
    if (l === 'en') continue;
    const title = text(form, `tr.${l}.title`).trim();
    const description = text(form, `tr.${l}.description`).trim();
    if (title) out[l] = { title, description: description || null };
  }
  return out;
}

function categoryFields(form: FormData) {
  return {
    audience: text(form, 'audience') as never,
    title: text(form, 'title'),
    description: text(form, 'description'),
    position: position(form),
    translations: translations(form),
  };
}

export async function createCategoryAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    const slug = text(form, 'slug').trim();
    await executeCommand(
      createHelpCategoryCommand,
      { ...categoryFields(form), slug: slug || undefined },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return redirect({
    href: `/o/${org}/help-center?tab=categories&created=1`,
    locale: data.ctx.locale ?? 'en',
  });
}

export async function updateCategoryAction(
  org: string,
  categoryId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(updateHelpCategoryCommand, { categoryId, ...categoryFields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return success();
}

export async function deleteCategoryAction(
  org: string,
  categoryId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await contentConsole(org);
  try {
    await executeCommand(deleteHelpCategoryCommand, { categoryId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh(org, data.org.id);
  return redirect({
    href: `/o/${org}/help-center?tab=categories&deleted=1`,
    locale: data.ctx.locale ?? 'en',
  });
}
