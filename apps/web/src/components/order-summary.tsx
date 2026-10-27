'use client';

import { Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { OrderPreviewInput, OrderPreviewState } from '@/app/[locale]/events/[slug]/actions.ts';

/** What the buyer has chosen so far, read from the checkout form's own fields. */
function readCart(form: HTMLFormElement): OrderPreviewInput {
  const data = new FormData(form);
  const items = [...data.entries()]
    .filter(([k, v]) => k.startsWith('qty:') && Number(v) > 0)
    .map(([k, v]) => {
      const ticketTypeId = k.slice(4);
      const amount = String(data.get(`amount:${ticketTypeId}`) ?? '').trim();
      return { ticketTypeId, quantity: Number(v), ...(amount ? { amount } : {}) };
    });
  const seatHold = String(data.get('seatHold') ?? '').trim();
  const promoCode = String(data.get('promoCode') ?? '').trim();
  const occurrenceId = String(data.get('occurrenceId') ?? '').trim();
  return {
    items,
    seats: seatHold ? [] : data.getAll('seat').map(String),
    ...(seatHold ? { seatHold } : {}),
    ...(promoCode ? { promoCode } : {}),
    ...(occurrenceId ? { occurrenceId } : {}),
  };
}

/**
 * The live order summary shown before the buyer continues: what they chose, the fee, any promo
 * discount and the total. Prices come from the server (`preview`), which uses the checkout's own
 * pricing; this component only reads the form and shows the answer.
 */
export function OrderSummary({
  preview,
  onFree,
}: {
  preview: (input: OrderPreviewInput) => Promise<OrderPreviewState>;
  /** Tells the form whether the priced cart is free (the button then says "Get tickets"). */
  onFree?: (free: boolean) => void;
}) {
  const t = useTranslations('checkout.summary');
  const anchor = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<OrderPreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    // Seat choices change hidden inputs without firing form events, so the cart is compared on a
    // short interval as well as on every input.
    const check = () => {
      const cart = readCart(form);
      const key = JSON.stringify(cart);
      if (key === last) return;
      last = key;
      clearTimeout(timer);
      if (cart.items.length === 0 && cart.seats.length === 0 && !cart.seatHold) {
        seq++;
        setState(null);
        onFree?.(false);
        setBusy(false);
        return;
      }
      setBusy(true);
      timer = setTimeout(() => {
        const mine = ++seq;
        preview(cart)
          .then((r) => {
            if (mine === seq) {
              setState(r);
              onFree?.(r.ok && r.free);
            }
          })
          .catch(() => {
            if (mine === seq) setState({ ok: false, reason: 'error' });
          })
          .finally(() => {
            if (mine === seq) setBusy(false);
          });
      }, 350);
    };
    form.addEventListener('input', check);
    form.addEventListener('change', check);
    const interval = setInterval(check, 700);
    check();
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      form.removeEventListener('input', check);
      form.removeEventListener('change', check);
    };
  }, [preview, onFree]);

  return (
    <div ref={anchor} aria-live="polite" aria-busy={busy}>
      {state === null ? null : (
        <Card tone="muted">
          {state.ok ? (
            <section aria-labelledby="order-summary-title" className="flex flex-col gap-2">
              <h2 id="order-summary-title" className="text-section">
                {t('title')}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {state.lines.map((l) => (
                  <li key={l.name} className="flex items-baseline justify-between gap-3 text-body">
                    <span>
                      {l.quantity} × {l.name}
                      <span className="ms-1 text-caption text-ink-2">({l.unit})</span>
                    </span>
                    <span className="tabular-nums">{l.total}</span>
                  </li>
                ))}
              </ul>
              <dl className="m-0 flex flex-col gap-1 border-t border-line pt-2 text-body">
                {state.discount || state.fee ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-2">{t('subtotal')}</dt>
                    <dd className="m-0 tabular-nums">{state.subtotal}</dd>
                  </div>
                ) : null}
                {state.discount ? (
                  <div className="flex justify-between gap-3 text-success">
                    <dt>{t('discount')}</dt>
                    <dd className="m-0 tabular-nums">−{state.discount}</dd>
                  </div>
                ) : null}
                {state.fee ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-2">{t('fee')}</dt>
                    <dd className="m-0 tabular-nums">{state.fee}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 text-[17px] font-extrabold">
                  <dt>{t('total')}</dt>
                  <dd className="m-0 tabular-nums">{state.free ? t('free') : state.total}</dd>
                </div>
              </dl>
              <p className="m-0 text-caption text-ink-2">{state.free ? t('noteFree') : t('note')}</p>
            </section>
          ) : state.reason === 'promo_invalid' ? (
            <p className="m-0 text-caption text-danger">{t('promoInvalid')}</p>
          ) : (
            <p className="m-0 text-caption text-ink-2">{t('unavailable')}</p>
          )}
        </Card>
      )}
    </div>
  );
}
