'use server';

import {
  moderateChatReportCommand,
  removeChatMessageCommand,
  restoreBoothChatCommand,
} from '@yayatoh/engagement';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Chat moderation actions in the networking console (M5.8b). The org and event come from the
 * route; the commands check the role (`events:write`) and only touch reported conversations.
 */
async function run(
  org: string,
  event: string,
  fn: (eventId: string, ctx: Awaited<ReturnType<typeof loadEvent>>['data']['ctx']) => Promise<unknown>,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  try {
    await fn(ev.id, data.ctx);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/networking`);
  return success();
}

export async function moderateChatAction(
  org: string,
  event: string,
  reportId: string,
  action: 'hide' | 'dismiss',
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(moderateChatReportCommand, { eventId, reportId, action }, ctx, ports),
  );
}

export async function removeChatMessageAction(
  org: string,
  event: string,
  messageId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(removeChatMessageCommand, { eventId, messageId }, ctx, ports),
  );
}

export async function restoreBoothChatAction(
  org: string,
  event: string,
  exhibitorId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(restoreBoothChatCommand, { eventId, exhibitorId }, ctx, ports),
  );
}
