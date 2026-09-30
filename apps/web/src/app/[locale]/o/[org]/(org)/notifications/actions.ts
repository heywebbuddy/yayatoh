'use server';

import { setUserLocale, USER_LOCALES, type UserLocale } from '@yayatoh/auth';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  MEMBER_CATEGORIES,
  markInboxReadCommand,
  PREFERENCE_CHANNELS,
  registerPushTokenCommand,
  removePushTokenCommand,
  sendTestNotificationCommand,
  setMyPreferencesCommand,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import type {
  PushActionResult,
  PushSubscriptionInput,
  RemoveDeviceState,
} from '@/components/web-push-control.tsx';
import { deviceLabel } from '@/lib/device-label.ts';
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

export type EmailLanguageState = { readonly ok: boolean; readonly code: string | null };

/**
 * The signed-in person's email language (M1.10d): member notifications (new orders, messages)
 * render in it, for every org they belong to. Identity data, so it is written through
 * packages/auth for the session's own user only; an unknown value is refused.
 */
export async function saveEmailLanguageAction(
  org: string,
  _prev: EmailLanguageState,
  form: FormData,
): Promise<EmailLanguageState> {
  const data = await loadConsole(org);
  const locale = String(form.get('locale') ?? '');
  if (!(USER_LOCALES as readonly string[]).includes(locale)) return { ok: false, code: 'validation_failed' };
  await setUserLocale(data.session.userId, locale as UserLocale);
  revalidatePath(`/o/${org}/notifications/preferences`);
  return { ok: true, code: null };
}

const pushCode = (err: unknown) =>
  isDomainError(err)
    ? (err.details as { reason?: string } | undefined)?.reason === 'too_many_devices'
      ? 'too_many_devices'
      : err.code
    : 'internal';

/** Opt this browser in to push for the signed-in member in this org (M1.10e). */
export async function subscribeMemberPushAction(
  org: string,
  sub: PushSubscriptionInput,
): Promise<PushActionResult> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      registerPushTokenCommand,
      {
        platform: 'webpush',
        subscription: {
          endpoint: sub.endpoint,
          keys: sub.keys,
          timeZone: sub.timeZone,
          label: deviceLabel((await headers()).get('user-agent')),
        },
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, code: pushCode(err) };
  }
  revalidatePath(`/o/${org}/notifications`, 'layout');
  return { ok: true, code: null };
}

/** "Turn off on this device" for the member. */
export async function unsubscribeMemberPushAction(org: string, endpoint: string): Promise<PushActionResult> {
  const data = await loadConsole(org);
  try {
    await executeCommand(removePushTokenCommand, { endpoint }, data.ctx, ports);
  } catch (err) {
    return { ok: false, code: pushCode(err) };
  }
  revalidatePath(`/o/${org}/notifications`, 'layout');
  return { ok: true, code: null };
}

/** Remove one of the member's own devices from the list. */
export async function removeMemberDeviceAction(
  org: string,
  _prev: RemoveDeviceState,
  form: FormData,
): Promise<RemoveDeviceState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      removePushTokenCommand,
      { deviceId: String(form.get('deviceId') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { removed: false, code: pushCode(err) };
  }
  revalidatePath(`/o/${org}/notifications`, 'layout');
  return { removed: true, code: null };
}
