'use server';

import { executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import { createCouponCommand, setCouponActiveCommand, setPromoCodeActiveCommand } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** U9 (UX-5): a new org-wide coupon. */
export async function createCouponAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  const kind = form.get('kind') === 'amount' ? 'amount' : 'percent';
  const value = String(form.get('value') ?? '')
    .trim()
    .replace(',', '.');
  const currency = String(form.get('currency') ?? data.org.currency).toUpperCase();
  const scope = form.get('scope') === 'events' ? 'events' : 'all';
  try {
    let amountMinor: number | null = null;
    if (kind === 'amount') {
      try {
        amountMinor = moneyFromDecimal(value || '0', currency).amount;
      } catch {
        return { ok: false, code: 'validation_failed', fields: ['value'] };
      }
    }
    await executeCommand(
      createCouponCommand,
      {
        code: String(form.get('code') ?? ''),
        kind,
        // "12.5" % → 1250 basis points; amounts in the chosen currency's minor units.
        percentBps: kind === 'percent' ? (value ? Math.round(Number(value) * 100) : null) : null,
        amountMinor,
        currency: kind === 'amount' ? currency : null,
        scope,
        eventIds: scope === 'events' ? form.getAll('eventIds').map(String) : [],
        maxRedemptions: numberOrNull(form, 'maxUses'),
        perBuyerLimit: numberOrNull(form, 'perBuyer'),
        startsAt: textOrNull(form, 'startsAt'),
        endsAt: textOrNull(form, 'endsAt'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/coupons`);
  return success();
}

export async function setCouponActiveAction(org: string, couponId: string, active: boolean): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(setCouponActiveCommand, { couponId, active }, data.ctx, ports);
  revalidatePath(`/o/${org}/coupons`);
}

/** Event promo codes are paused and resumed from the same list. */
export async function setEventCodeActiveAction(
  org: string,
  promoCodeId: string,
  active: boolean,
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(setPromoCodeActiveCommand, { promoCodeId, active }, data.ctx, ports);
  revalidatePath(`/o/${org}/coupons`);
}
