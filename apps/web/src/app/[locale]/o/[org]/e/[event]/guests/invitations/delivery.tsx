import type { DeliveryState, InviteChannel } from '@yayatoh/guests';
import { StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';

/** Delivery as dot + word (ADR 0022): problems red, delivered mint, on the way violet. */
const TONE = {
  queued: 'neutral',
  waiting: 'waiting',
  sent: 'info',
  delivered: 'success',
  bounced: 'danger',
  failed: 'danger',
  not_sent: 'danger',
  canceled: 'neutral',
} as const satisfies Record<DeliveryState, 'neutral' | 'waiting' | 'info' | 'success' | 'danger'>;

/** A language's own name in the console's language (Intl, no message keys). */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** One message's channel and delivery state ("Email · Bounced"), problems called out. */
export async function DeliveryPill({ channel, state }: { channel: InviteChannel; state: DeliveryState }) {
  const t = await getTranslations('invitations');
  return (
    <span className="inline-flex" data-testid={`delivery-${channel}`}>
      <StatusPill
        tone={TONE[state]}
        label={t('delivery', { channel: t(`channels.${channel}`), state: t(`deliveryStates.${state}`) })}
      />
    </span>
  );
}
