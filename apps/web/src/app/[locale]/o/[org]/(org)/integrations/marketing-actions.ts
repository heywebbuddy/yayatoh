'use server';

import { providerLists, saveAudienceSyncCommand } from '@yayatoh/integrations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function back(org: string, connectionId: string, params: Record<string, string>) {
  const locale = await getLocale();
  revalidatePath(`/o/${org}/integrations`, 'layout');
  return redirect({
    href: { pathname: `/o/${org}/integrations/${connectionId}`, query: params },
    locale,
  });
}

/**
 * M6.4d: choose what a Mailchimp or Klaviyo connection pushes (a saved audience, or everyone with
 * email marketing consent) and the provider list it lands in. The list is checked against the
 * provider's own lists (through the port) and its name taken from there.
 */
export async function saveAudienceAction(org: string, connectionId: string, form: FormData): Promise<void> {
  if (!UUID.test(connectionId)) return back(org, connectionId, { audience: 'not_found' });
  const data = await loadConsole(org);
  const auth = integrationAuth();
  const segment = String(form.get('segment') ?? '');
  const listId = String(form.get('list') ?? '');
  if (!listId) return back(org, connectionId, { audience: 'list_required' });
  if (segment && !UUID.test(segment)) return back(org, connectionId, { audience: 'validation_failed' });
  let listName: string | undefined;
  try {
    listName = auth
      ? (await providerLists(data.ctx, auth, connectionId)).find((l) => l.id === listId)?.name
      : undefined;
  } catch {
    return back(org, connectionId, { audience: 'provider_unavailable' });
  }
  if (!listName) return back(org, connectionId, { audience: 'list_required' });
  try {
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: segment || null, listId, listName },
      data.ctx,
      ports,
    );
  } catch (err) {
    return back(org, connectionId, { audience: isDomainError(err) ? err.code : 'internal' });
  }
  return back(org, connectionId, { audience: 'saved' });
}
