'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  MEMBER_CATEGORIES,
  markInboxReadCommand,
  PREFERENCE_CHANNELS,
  sendTestNotificationCommand,
  setMyPreferencesCommand,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { loadConsole } from '@/server/console.ts';
import { type InboxView, loadInbox } from '@/server/inbox.ts';
import { ports } from '@/server/ports.ts';

/** The bell's poll: the signed-in member's latest items and unread count. */
export async function inboxAction(org: string): Promise<InboxView> {
  return loadInbox(await loadConsole(org));
}

/** Mark some or all of the member's own items read; returns the refreshed inbox. */
export async function markReadAction(org: string, ids: readonly string[] | 'all'): Promise<InboxView> {
  const data = await loadConsole(org);
  const parsed = z.array(z.uuid()).max(100).safeParse(ids);
  await executeCommand(
    markInboxReadCommand,
    ids === 'all' ? { all: true } : { ids: parsed.success ? parsed.data : [] },
    data.ctx,
    ports,
  ).catch((err) => {
    if (!(isDomainError(err) && err.code === 'validation_failed')) throw err;
  });
  revalidatePath(`/o/${org}/notifications`);
  return loadInbox(data);
}

/** The inbox page's no-JS forms: one item (`id`) or everything. */
export async function markReadFormAction(org: string, form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  await markReadAction(org, id ? [id] : 'all');
}

export type PreferencesState = {
  readonly saved: boolean;
  readonly tested: boolean;
  readonly code: string | null;
};

/** Save the whole grid: every checkbox is posted when checked; the rest are off. */
export async function savePreferencesAction(
  org: string,
  _prev: PreferencesState,
  form: FormData,
): Promise<PreferencesState> {
  const data = await loadConsole(org);
  try {
    if (form.get('intent') === 'test') {
      await executeCommand(sendTestNotificationCommand, {}, data.ctx, ports);
      revalidatePath(`/o/${org}`, 'layout');
      return { saved: false, tested: true, code: null };
    }
    const preferences = MEMBER_CATEGORIES.flatMap((category) =>
      PREFERENCE_CHANNELS.map((channel) => ({
        category,
        channel,
        enabled: form.get(`${category}:${channel}`) === 'on',
      })),
    );
    await executeCommand(setMyPreferencesCommand, { preferences }, data.ctx, ports);
  } catch (err) {
    return { saved: false, tested: false, code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/notifications/preferences`);
  return { saved: true, tested: false, code: null };
}
