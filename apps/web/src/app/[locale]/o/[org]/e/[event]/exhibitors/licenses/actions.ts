'use server';

import { executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import { saveLeadLicenseSettingsCommand } from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Lead licenses, organizer side (M5.4b, P5-4): included licenses and the price of extra ones. */
export async function saveLicenseSettingsAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'exhibitors');
  const priceText = String(form.get('price') ?? '').trim();
  let price: number | null = null;
  if (priceText) {
    try {
      price = moneyFromDecimal(priceText, ev.currency).amount;
    } catch {
      return { ok: false, code: 'validation_failed', fields: ['price'] };
    }
  }
  try {
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      {
        eventId: ev.id,
        includedLeadLicenses: numberOrNull(form, 'included') ?? Number.NaN,
        leadLicensePriceMinor: price,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    const rename = (x: string) =>
      x === 'includedLeadLicenses' ? 'included' : x === 'leadLicensePriceMinor' ? 'price' : x;
    return f.fields ? { ...f, fields: f.fields.map(rename) } : f;
  }
  revalidatePath(`/o/${org}/e/${event}/exhibitors/licenses`);
  return success();
}
