'use server';

import { executeCommand } from '@yayatoh/kernel';
import { acceptLeadTermsCommand, LEAD_TERMS_VERSION, saveLeadSettingsCommand } from '@yayatoh/leads';
import { refresh } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { failure, success } from '@/server/form.ts';
import { portalRequestCtx, requirePortalPrincipal } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { type PortalSignInState, portalSignInAction } from './actions.ts';

/**
 * Lead retrieval in the exhibitor portal (M5.6b). The admin's settings and the lead terms are
 * `portal:exhibitor_admin` commands; they act on the signed-in person's own exhibitor.
 */
async function ctx() {
  return portalRequestCtx(await requirePortalPrincipal());
}

export async function saveLeadSettingsAction(
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  try {
    await executeCommand(
      saveLeadSettingsCommand,
      {
        qualifiers: String(form.get('qualifiers') ?? '')
          .split('\n')
          .map((q) => q.trim())
          .filter(Boolean),
        teamVisibility: form.getAll('teamVisibility').includes('on'),
      },
      await ctx(),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}

export async function acceptLeadTermsAction(
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  if (!form.getAll('accept').includes('on'))
    return { ok: false, code: 'validation_failed', fields: ['accept'], reason: 'accept_required' };
  try {
    await executeCommand(acceptLeadTermsCommand, { version: LEAD_TERMS_VERSION }, await ctx(), ports);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}

/**
 * Step-up before the lead export: the one portal sign-in flow emails a fresh code (a new sign-in
 * is the re-authentication); once it signs in, the portal opens on the Leads section, ready.
 */
export async function confirmForExportAction(
  inviteToken: string,
  prev: PortalSignInState,
  form: FormData,
): Promise<PortalSignInState> {
  const r = await portalSignInAction(inviteToken, prev, form);
  if (!r.done) return r;
  const locale = await getLocale();
  return { ...r, done: `${locale === 'en' ? '' : `/${locale}`}/event-portal?export=ready#leads-heading` };
}
