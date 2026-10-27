'use server';

import { moderateLobbyReportCommand, setLobbyEnabledCommand } from '@yayatoh/engagement';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

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

export async function setLobbyAction(
  org: string,
  event: string,
  enabled: boolean,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(setLobbyEnabledCommand, { eventId, enabled }, ctx, ports),
  );
}

export async function moderateLobbyAction(
  org: string,
  event: string,
  reportId: string,
  action: 'remove' | 'hide' | 'dismiss',
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(moderateLobbyReportCommand, { eventId, reportId, action }, ctx, ports),
  );
}
