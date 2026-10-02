import type { DeliveryState, InviteChannel } from '@yayatoh/guests';
import { getTranslations } from 'next-intl/server';

const pill = 'rounded-pill px-2 py-px text-caption';
const BAD = new Set<DeliveryState>(['bounced', 'failed', 'not_sent']);

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
    <span
      className={`${pill} ${BAD.has(state) ? 'bg-pink-50 text-pink-700' : 'bg-zinc-100 text-zinc-700'}`}
      data-testid={`delivery-${channel}`}
    >
      {t('delivery', { channel: t(`channels.${channel}`), state: t(`deliveryStates.${state}`) })}
    </span>
  );
}
