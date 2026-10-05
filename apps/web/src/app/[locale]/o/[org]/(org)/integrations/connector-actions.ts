'use server';

import {
  isProviderError,
  linkEventSheet,
  requestSyncCommand,
  unlinkSheetCommand,
} from '@yayatoh/integrations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

/**
 * M6.4b connector actions: start an Eventbrite import (after its preview), link and unlink an
 * event's Google Sheet. The provider calls happen here, outside any transaction; the commands
 * keep the state.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const codeOf = (err: unknown) =>
  isDomainError(err)
    ? err.details?.reason === 'already_linked'
      ? 'already_linked'
      : err.code
    : isProviderError(err)
      ? 'provider_unavailable'
      : 'internal';

async function back(org: string, path: string, params: Record<string, string>) {
  const locale = await getLocale();
  revalidatePath(`/o/${org}/integrations`, 'layout');
  return redirect({ href: { pathname: `/o/${org}/integrations${path}`, query: params }, locale });
}

/** The wizard's Import: queue the import run (the worker runs it; the result step shows it). */
export async function startImportAction(org: string, connectionId: string, _form?: FormData): Promise<void> {
  const data = await loadConsole(org);
  if (!UUID.test(connectionId)) return back(org, '', { error: 'not_found' });
  let already = false;
  try {
    ({ already } = await executeCommand(requestSyncCommand, { connectionId }, data.ctx, ports));
  } catch (err) {
    return back(org, `/${connectionId}/import`, { error: codeOf(err) });
  }
  return back(org, `/${connectionId}/import`, { started: already ? 'already' : '1' });
}

export interface LinkSheetState {
  readonly status: 'idle' | 'error';
  /** `choose_event` (inline), or a feedback code. */
  readonly code?: string;
}

/** Link an event: its spreadsheet is created at Google, then linked and filled by the next sync. */
export async function linkSheetAction(
  org: string,
  connectionId: string,
  _prev: LinkSheetState,
  form: FormData,
): Promise<LinkSheetState> {
  const data = await loadConsole(org);
  const eventId = String(form.get('event') ?? '');
  if (!UUID.test(eventId)) return { status: 'error', code: 'choose_event' };
  const auth = integrationAuth();
  if (!auth || !UUID.test(connectionId)) return { status: 'error', code: 'unavailable' };
  try {
    await linkEventSheet(data.ctx, { auth }, ports, { connectionId, eventId });
  } catch (err) {
    return { status: 'error', code: codeOf(err) };
  }
  return back(org, `/${connectionId}`, { done: 'linked' });
}

export async function unlinkSheetAction(
  org: string,
  connectionId: string,
  linkId: string,
  _form?: FormData,
): Promise<void> {
  const data = await loadConsole(org);
  if (!UUID.test(connectionId) || !UUID.test(linkId)) return back(org, '', { error: 'not_found' });
  try {
    await executeCommand(unlinkSheetCommand, { connectionId, linkId }, data.ctx, ports);
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, `/${connectionId}`, { done: 'unlinked' });
}
