'use server';

import {
  addOrgCategoryCommand,
  EVENT_CATEGORIES,
  moveOrgCategoryCommand,
  renameOrgCategoryCommand,
  setOrgCategoryHiddenCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string) => {
  revalidatePath(`/o/${org}/settings/categories`);
  revalidatePath(`/o/${org}`);
};

/** U8: add an org category (name + the marketplace category it maps to). */
export async function addCategoryAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  const platformKey = String(form.get('platformKey') ?? '');
  try {
    await executeCommand(
      addOrgCategoryCommand,
      {
        name: String(form.get('name') ?? ''),
        platformKey: (EVENT_CATEGORIES as readonly string[]).includes(platformKey)
          ? (platformKey as (typeof EVENT_CATEGORIES)[number])
          : 'other',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org);
  return success();
}

/** U8: one category's row actions: rename, hide, show, move up or down. */
export async function categoryRowAction(
  org: string,
  category: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const intent = String(form.get('intent') ?? '');
  try {
    if (intent === 'rename')
      await executeCommand(
        renameOrgCategoryCommand,
        { category, name: String(form.get('name') ?? '') },
        data.ctx,
        ports,
      );
    else if (intent === 'hide' || intent === 'show')
      await executeCommand(
        setOrgCategoryHiddenCommand,
        { category, hidden: intent === 'hide' },
        data.ctx,
        ports,
      );
    else if (intent === 'up' || intent === 'down')
      await executeCommand(moveOrgCategoryCommand, { category, direction: intent }, data.ctx, ports);
    else return { ok: false, code: 'validation_failed' };
  } catch (err) {
    return failure(err);
  }
  done(org);
  return { ...success(), reason: intent };
}
