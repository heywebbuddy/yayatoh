'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  AGENCY_GRANT_ROLES,
  grantAgencyAccessCommand,
  revokeAgencyGrantCommand,
  updateAgencyGrantCommand,
} from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type AgencyGrantState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'granted'; readonly agency: string }
  | {
      readonly kind: 'error';
      readonly code: string;
      /** `required`, `unknown`, `self` or `taken`: the agency field's message. */
      readonly agency?: 'required' | 'unknown' | 'self' | 'taken';
      readonly values: { readonly agency: string; readonly role: string; readonly finance: boolean };
    };

/** Give an agency access (M6.7a). A step-up command: "Confirm it's you" opens and the form resubmits. */
export async function grantAgencyAction(
  org: string,
  _prev: AgencyGrantState,
  form: FormData,
): Promise<AgencyGrantState> {
  const data = await loadConsole(org);
  const agency = String(form.get('agency') ?? '').trim();
  const roleRaw = String(form.get('role') ?? 'viewer');
  const role = (AGENCY_GRANT_ROLES as readonly string[]).includes(roleRaw) ? roleRaw : 'viewer';
  const finance = form.get('finance') === 'on';
  const values = { agency, role, finance };
  if (!agency) return { kind: 'error', code: 'validation_failed', agency: 'required', values };
  try {
    const r = await executeCommand(grantAgencyAccessCommand, { agency, role, finance }, data.ctx, ports);
    revalidatePath(`/o/${org}/agencies`);
    return { kind: 'granted', agency: r.agencyName ?? agency };
  } catch (err) {
    if (!isDomainError(err)) return { kind: 'error', code: 'internal', values };
    const issue = (err.details?.issues as { path: string; code?: string }[] | undefined)?.find(
      (i) => i.path === 'agency',
    );
    const field =
      err.code === 'conflict'
        ? 'taken'
        : issue?.code === 'self'
          ? 'self'
          : issue?.code === 'unknown_agency'
            ? 'unknown'
            : issue
              ? 'unknown'
              : undefined;
    return { kind: 'error', code: err.code, ...(field ? { agency: field } : {}), values };
  }
}

/** Revoke an agency's access (no step-up: taking access away is always one click). */
export async function revokeAgencyAction(
  org: string,
  grantId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  try {
    await executeCommand(revokeAgencyGrantCommand, { grantId }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/agencies`);
  // The page confirms which agency lost access (looked up from the grant, never from the URL text).
  redirect({ href: `/o/${org}/agencies?revoked=${grantId}`, locale: await getLocale() });
}

/** Turn the agency's read access to the org's money on or off (step-up). */
export async function setAgencyFinanceAction(
  org: string,
  grantId: string,
  role: string,
  finance: boolean,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  try {
    await executeCommand(updateAgencyGrantCommand, { grantId, role, finance }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/agencies`);
}
