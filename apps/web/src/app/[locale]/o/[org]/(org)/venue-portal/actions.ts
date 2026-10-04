'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { shareLayoutCommand, unshareLayoutCommand } from '@yayatoh/seating';
import { addVenuePartnerCommand, removeVenuePartnerCommand } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type PartnerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'added'; readonly slug: string }
  /** `not_found`, `self`, `invalid` (field errors) or another error code. */
  | { readonly kind: 'error'; readonly code: string; readonly reason?: 'not_found' | 'self' | 'invalid' };

/** Add a partner organizer by its address (M6.14b). */
export async function addPartnerAction(
  org: string,
  _prev: PartnerState,
  form: FormData,
): Promise<PartnerState> {
  const data = await loadConsole(org);
  const slug = String(form.get('slug') ?? '')
    .trim()
    .replace(/^.*\/o\//, '')
    .replace(/\/.*$/, '');
  if (!slug) return { kind: 'error', code: 'validation_failed', reason: 'invalid' };
  try {
    await executeCommand(addVenuePartnerCommand, { slug }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'not_found') return { kind: 'error', code: err.code, reason: 'not_found' };
    if (err.details?.reason === 'self') return { kind: 'error', code: err.code, reason: 'self' };
    if (err.code === 'validation_failed') return { kind: 'error', code: err.code, reason: 'invalid' };
    return { kind: 'error', code: err.code };
  }
  revalidatePath(`/o/${org}/venue-portal`);
  return { kind: 'added', slug: slug.toLowerCase() };
}

const back = async (org: string, done: string) =>
  redirect({ href: `/o/${org}/venue-portal?done=${done}`, locale: await getLocale() });

export async function removePartnerAction(org: string, partnerOrgId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(removeVenuePartnerCommand, { orgId: partnerOrgId }, data.ctx, ports);
  revalidatePath(`/o/${org}/venue-portal`);
  return back(org, 'removed');
}

export async function setShareAction(
  org: string,
  layoutId: string,
  partnerOrgId: string,
  shared: boolean,
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(
    shared ? shareLayoutCommand : unshareLayoutCommand,
    { layoutId, partnerOrgId },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/venue-portal`);
  return back(org, shared ? 'shared' : 'unshared');
}
