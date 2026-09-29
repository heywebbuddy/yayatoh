'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { preferencesRef, savePreferenceCenterCommand } from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { ports } from '@/server/ports.ts';

export interface PreferenceChoices {
  readonly emailCategories: { reminders: boolean; event_updates: boolean; marketing: boolean };
  readonly sms: { informational: boolean; marketing: boolean };
  readonly whatsapp: { informational: boolean; marketing: boolean };
}

export interface PreferenceState {
  readonly saved: boolean;
  readonly error: 'invalid_phone' | 'phone_required' | 'not_found' | 'internal' | null;
  readonly phone: string;
  readonly choices: PreferenceChoices;
}

/** Save the recipient's preferences; the org comes from the path and the token is the credential. */
export async function savePreferencesAction(
  orgId: string,
  token: string,
  _prev: PreferenceState,
  form: FormData,
): Promise<PreferenceState> {
  const on = (name: string) => form.get(name) === 'on';
  const choices: PreferenceChoices = {
    emailCategories: {
      reminders: on('email.reminders'),
      event_updates: on('email.event_updates'),
      marketing: on('email.marketing'),
    },
    sms: { informational: on('sms.informational'), marketing: on('sms.marketing') },
    whatsapp: { informational: on('whatsapp.informational'), marketing: on('whatsapp.marketing') },
  };
  const phone = String(form.get('phone') ?? '').trim();
  if (!preferencesRef(orgId, token)) return { saved: false, error: 'not_found', phone, choices };
  try {
    await executeCommand(
      savePreferenceCenterCommand,
      { token, ...choices, phone: phone || null },
      createCtx({ orgId }),
      ports,
    );
  } catch (err) {
    const reason = isDomainError(err) ? String(err.details?.reason ?? '') : '';
    const error =
      reason === 'invalid_phone' || reason === 'phone_required'
        ? reason
        : isDomainError(err) && err.code === 'not_found'
          ? 'not_found'
          : 'internal';
    return { saved: false, error, phone, choices };
  }
  revalidatePath('/[locale]/preferences/[org]/[token]', 'page');
  return { saved: true, error: null, phone: '', choices };
}
