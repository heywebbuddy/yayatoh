'use server';

import { refreshAgencySnapshotsCommand } from '@yayatoh/agency';
import { offerAgencyBillingCommand, withdrawAgencyBillingOfferCommand } from '@yayatoh/billing';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadAgency } from './load.ts';

export type RefreshState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly clients: number }
  | { readonly kind: 'error'; readonly code: string };

/** Rebuild the agency's client snapshots now (each client computed under its own tenant). */
export async function refreshAgencyAction(org: string, _prev: RefreshState): Promise<RefreshState> {
  const { data } = await loadAgency(org);
  try {
    const r = await executeCommand(refreshAgencySnapshotsCommand, {}, data.ctx, ports);
    revalidatePath(`/o/${org}/agency`, 'layout');
    return { kind: 'done', clients: r.clients };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

/** M6.8a: offer to pay a client's plan (step-up); the page confirms it. */
export async function offerAgencyBillingAction(
  org: string,
  clientOrgId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const { data } = await loadAgency(org);
  try {
    await executeCommand(offerAgencyBillingCommand, { clientOrgId }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/agency/billing`);
  redirect({ href: `/o/${org}/agency/billing?offered=${clientOrgId}`, locale: await getLocale() });
}

/** M6.8a: withdraw an offer (agency billing it backed stops). */
export async function withdrawAgencyBillingAction(
  org: string,
  clientOrgId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const { data } = await loadAgency(org);
  try {
    await executeCommand(withdrawAgencyBillingOfferCommand, { clientOrgId }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/agency/billing`);
  redirect({ href: `/o/${org}/agency/billing?withdrawn=${clientOrgId}`, locale: await getLocale() });
}
