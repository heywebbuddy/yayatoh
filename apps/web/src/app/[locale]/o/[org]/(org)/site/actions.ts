'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { revalidatePath, updateTag } from 'next/cache';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import type { SettingsState } from '../settings/actions.ts';

const fail = (err: unknown): SettingsState => ({
  ok: false,
  code: isDomainError(err) ? err.code : 'internal',
});

/** Marketplace enrollment (D13) and the tenant-site switch. */
export async function publicSiteAction(
  org: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      updateSiteSettingsCommand,
      {
        listOnMarketplace: form.get('listOnMarketplace') === 'on',
        tenantSite: form.get('tenantSite') === 'on',
      },
      data.ctx,
      ports,
    );
    for (const tag of orgChangeTags(data.org.id)) updateTag(tag);
    revalidatePath(`/o/${org}/site`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** The websites allowed to embed the ticket widget, one per line. */
export async function widgetOriginsAction(
  org: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  const lines = String(form.get('origins') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  try {
    await executeCommand(updateSiteSettingsCommand, { embedOrigins: lines }, data.ctx, ports);
    revalidatePath(`/o/${org}/site`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** M1.4g: the CMS pages the tenant site's header links, in the order they are listed. */
export async function navPagesAction(
  org: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      updateSiteSettingsCommand,
      { navPageIds: form.getAll('navPage').map(String) },
      data.ctx,
      ports,
    );
    for (const tag of orgChangeTags(data.org.id)) updateTag(tag);
    revalidatePath(`/o/${org}/site`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}
