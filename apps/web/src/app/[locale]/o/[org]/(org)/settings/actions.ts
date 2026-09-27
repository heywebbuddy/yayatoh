'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  AGREEMENT_DOCUMENTS,
  type AgreementDocument,
  acceptAgreementCommand,
  LEGAL_PAGE_KINDS,
  type LegalPageKind,
  setLegalPageCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type SettingsState = { readonly ok: boolean; readonly code: string | null };
const fail = (err: unknown): SettingsState => ({
  ok: false,
  code: isDomainError(err) ? err.code : 'internal',
});

export async function generalAction(
  org: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      updateOrganizationCommand,
      {
        name: String(form.get('name') ?? ''),
        defaultLocale: String(form.get('defaultLocale') ?? ''),
        timezone: String(form.get('timezone') ?? ''),
        country: String(form.get('country') ?? '').toUpperCase(),
        currency: String(form.get('currency') ?? '').toUpperCase(),
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}`, 'layout');
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function brandAction(org: string, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const data = await loadConsole(org);
  const raw = String(form.get('brandColor') ?? '').trim();
  try {
    await executeCommand(updateOrganizationCommand, { brandColor: raw || null }, data.ctx, ports);
    revalidatePath(`/o/${org}`, 'layout');
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function legalAction(
  org: string,
  kind: LegalPageKind,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  if (!LEGAL_PAGE_KINDS.includes(kind)) return { ok: false, code: 'validation_failed' };
  try {
    await executeCommand(
      setLegalPageCommand,
      { kind, body: String(form.get('body') ?? '') },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/settings`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function acceptAction(
  org: string,
  document: AgreementDocument,
  version: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  if (!AGREEMENT_DOCUMENTS.includes(document)) return { ok: false, code: 'validation_failed' };
  if (form.get('agree') !== 'yes') return { ok: false, code: 'validation_failed' };
  try {
    await executeCommand(acceptAgreementCommand, { document, version }, data.ctx, ports);
    revalidatePath(`/o/${org}`, 'layout');
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}
