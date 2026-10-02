'use server';

import { checkoutTarget } from '@yayatoh/events';
import { startRegistrationFormCommand } from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { publicRegistrationTypes } from '@/server/registration-types.ts';

export interface RegistrationStartState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
}

/**
 * Start the event's registration form (public, M5.1b). The org and event come from the slug
 * (server-side), the registration type must be one the event offers; rate-limited per device and
 * per address. On success the person continues on their own signed link.
 */
export async function startRegistrationFormAction(
  slug: string,
  _prev: RegistrationStartState,
  form: FormData,
): Promise<RegistrationStartState> {
  const locale = await getLocale();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 120);
  const email = String(form.get('email') ?? '')
    .trim()
    .slice(0, 254);
  const type = String(form.get('type') ?? '');
  if (!type) return { code: 'validation_failed', field: 'type' };
  if (!name) return { code: 'validation_failed', field: 'name' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { code: 'validation_failed', field: 'email' };
  const target = await checkoutTarget(slug);
  if (!target) return { code: 'not_found' };
  if (!(await publicRegistrationTypes(slug)).some((t) => t.id === type))
    return { code: 'validation_failed', field: 'type' };
  const limit = await limitAction('registrationForm', { identity: email.toLowerCase(), scope: 'start' });
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  let token: string;
  try {
    ({ token } = await executeCommand(
      startRegistrationFormCommand,
      { eventId: target.eventId, registrationTypeId: type, name, email, locale },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { code: err.code, reason: String(err.details?.reason ?? '') };
  }
  redirect({ href: `/registration-form/${token}`, locale });
  return { code: null };
}
