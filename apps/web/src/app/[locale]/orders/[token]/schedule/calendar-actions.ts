'use server';

import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import {
  beginPersonalCalendarCommand,
  googleCalendarPersonalConnector,
  stopPersonalCalendarCommand,
  syncPersonalCalendarCommand,
} from '@yayatoh/integrations';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import type { CalendarActionState } from '@/components/schedule-calendar.tsx';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Personal calendar push from "My schedule" (M6.5c). The order's manage link is the only
 * credential: the org comes from it (never from the request), and every command re-checks that
 * the registrant is the order's. Connecting goes through the `IntegrationAuth` port (the fake's
 * own consent page in dev and CI); tokens never pass through here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONNECTOR = googleCalendarPersonalConnector;

async function prefix() {
  const locale = await getLocale();
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

async function schedulePath(token: string, registrantId: string, q: Record<string, string>) {
  const query = new URLSearchParams({ registrant: registrantId, ...q });
  return `${await prefix()}/orders/${token}/schedule?${query.toString()}#calendar`;
}

/** "Add to Google Calendar": a pending connection, then off to the consent screen. */
export async function connectCalendarAction(
  token: string,
  registrantId: string,
  _form?: FormData,
): Promise<void> {
  const back = async (calendar: string) => redirect(await schedulePath(token, registrantId, { calendar }));
  if (!UUID.test(registrantId)) return back('not_found');
  const limit = await limitAction('sessionEnrollment', { identity: `order:${token}`, scope: 'calendar' });
  if (!limit.allowed) return back('rate_limited');
  const auth = integrationAuth();
  const orgId = await manageTokenOrg(token);
  if (!auth || !orgId) return back('unavailable');
  let begun: { connectionId: string; state: string };
  try {
    begun = await executeCommand(
      beginPersonalCalendarCommand,
      { token, registrantId },
      createCtx({ orgId }),
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return back(err.code === 'module_not_enabled' ? 'unavailable' : err.code);
  }
  const p = await prefix();
  let url: string;
  try {
    ({ url } = await auth.beginConnect({
      orgId,
      connectionId: begun.connectionId,
      providerConfigKey: CONNECTOR.providerConfigKey,
      scopes: CONNECTOR.scopes,
      state: begun.state,
      callbackUrl: `${p}/orders/${token}/schedule/calendar/${registrantId}`,
    }));
  } catch {
    return back('provider_unavailable');
  }
  redirect(url.startsWith('/') ? `${p}${url}` : url);
}

/** "Update now" and "Stop syncing" (the pressed button's `intent`). */
export async function calendarAction(
  token: string,
  registrantId: string,
  _prev: CalendarActionState,
  form: FormData,
): Promise<CalendarActionState> {
  const intent = String(form.get('intent') ?? '');
  if (!UUID.test(registrantId) || (intent !== 'sync' && intent !== 'stop'))
    return { ok: false, code: 'not_found' };
  const limit = await limitAction('sessionEnrollment', { identity: `order:${token}`, scope: 'calendar' });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const orgId = await manageTokenOrg(token);
  if (!orgId) return { ok: false, code: 'not_found' };
  const ctx = createCtx({ orgId });
  try {
    if (intent === 'sync') {
      const r = await executeCommand(syncPersonalCalendarCommand, { token, registrantId }, ctx, ports);
      revalidatePath(`/orders/${token}/schedule`);
      return { ok: true, code: null, done: r.already ? 'already' : 'queued', stamp: Date.now() };
    }
    const stopped = await executeCommand(stopPersonalCalendarCommand, { token, registrantId }, ctx, ports);
    // Revoked here first (nothing syncs any more); then at Google, best effort (it can be retried there).
    const auth = integrationAuth();
    if (auth && stopped.authConnectionId)
      await auth
        .revoke({
          orgId,
          connectionId: stopped.connectionId,
          providerConfigKey: stopped.providerConfigKey,
          authConnectionId: stopped.authConnectionId,
        })
        .catch(() => undefined);
    revalidatePath(`/orders/${token}/schedule`);
    return { ok: true, code: null, done: 'stopped', stamp: Date.now() };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
}
