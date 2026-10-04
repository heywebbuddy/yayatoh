'use server';

import {
  DIGEST_TIME,
  queueSlackTestCommand,
  runSlackDispatch,
  saveSlackSettingsCommand,
  slackChannelsFor,
  slackPanelQuery,
} from '@yayatoh/integrations';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { appOrigin } from '@/server/tenant-return.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEVERITIES = new Set(['info', 'warning', 'critical']);

/** What the Slack settings form shows after a save: success, or a code per field (never raw text). */
export interface SlackFormState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly code?: string;
  readonly fields?: Readonly<Record<string, string>>;
}

/**
 * Save a Slack connection's channel, alerts and digest (M6.4c). The channel must be one the
 * workspace lists right now through the port and the app is in; the command checks the rest.
 */
export async function saveSlackSettingsAction(
  org: string,
  connectionId: string,
  _prev: SlackFormState,
  form: FormData,
): Promise<SlackFormState> {
  const data = await loadConsole(org);
  const auth = integrationAuth();
  if (!auth || !UUID.test(connectionId)) return { status: 'error', code: 'unavailable' };
  const channelId = String(form.get('channel') ?? '');
  const alertsEnabled = form.get('alerts') === 'on';
  const digestEnabled = form.get('digest') === 'on';
  const includeFinance = form.get('finance') === 'on';
  const alertMinSeverity = String(form.get('severity') ?? 'warning');
  const digestTime = String(form.get('digestTime') ?? '').trim();
  const fields: Record<string, string> = {};
  if (!channelId) fields.channel = 'required';
  if (digestEnabled && !DIGEST_TIME.test(digestTime)) fields.digestTime = digestTime ? 'invalid' : 'required';
  if (!SEVERITIES.has(alertMinSeverity)) fields.severity = 'invalid';
  let channelName = '';
  if (channelId) {
    const channels = await slackChannelsFor(connectionId, data.ctx, ports, auth).catch(() => null);
    if (!channels) return { status: 'error', code: 'provider_unavailable' };
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) fields.channel = 'unknown';
    else if (!ch.isMember) fields.channel = 'not_in_channel';
    else channelName = ch.name;
  }
  if (Object.keys(fields).length) return { status: 'error', code: 'validation_failed', fields };
  try {
    await executeCommand(
      saveSlackSettingsCommand,
      {
        connectionId,
        channelId,
        channelName,
        alertsEnabled,
        alertMinSeverity: alertMinSeverity as 'info' | 'warning' | 'critical',
        digestEnabled,
        digestTime: digestEnabled ? digestTime : DIGEST_TIME.test(digestTime) ? digestTime : '08:00',
        includeFinance,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.details?.reason === 'finance_owner_only')
      return { status: 'error', code: 'validation_failed', fields: { finance: 'finance_owner_only' } };
    return { status: 'error', code: err.code };
  }
  revalidatePath(`/o/${org}/integrations/${connectionId}`);
  return { status: 'saved' };
}

/** Send a test alert to the connection's channel now (queued, then sent in the same request). */
export async function sendSlackTestAction(
  org: string,
  connectionId: string,
  _form?: FormData,
): Promise<void> {
  const data = await loadConsole(org);
  const auth = integrationAuth();
  const locale = await getLocale();
  const back = (query: Record<string, string>) => {
    revalidatePath(`/o/${org}/integrations/${connectionId}`);
    return redirect({ href: { pathname: `/o/${org}/integrations/${connectionId}`, query }, locale });
  };
  if (!auth || !UUID.test(connectionId)) return back({ slackError: 'unavailable' });
  let queued: { messageId: string; channelName: string };
  try {
    queued = await executeCommand(queueSlackTestCommand, { connectionId }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return back({ slackError: String(err.details?.reason ?? err.code) });
  }
  const orgId = data.ctx.orgId as string;
  const r = await runSlackDispatch(orgId, { auth, appOrigin: appOrigin() }, ports, { connectionId });
  if (r.revoked.length) return back({ slackError: 'auth_revoked' });
  if (r.sent > 0) return back({ slack: 'sent', channel: queued.channelName });
  // Why it did not go: the test message's own code (`not_in_channel`, …), never Slack's text.
  const panel = await executeQuery(slackPanelQuery, { connectionId }, data.ctx, ports);
  const mine = panel.messages.find((m) => m.id === queued.messageId);
  return back({ slackError: mine?.errorCode ?? 'send_failed' });
}
