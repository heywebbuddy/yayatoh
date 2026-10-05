import { randomUUID } from 'node:crypto';
import type { PublicCampaignDto } from '@yayatoh/donations';
import { formatMoney, money } from '@yayatoh/kernel';
import { Alert, Button } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { giveCard } from './give-frame.tsx';
import { giveWithCardAction } from './one-tap-actions.ts';

/**
 * One-tap giving with the card this device saved (M4.8e): one button per level, each its own
 * form (works without JavaScript and with the keyboard); 44 px targets. Other amounts and the fee
 * cover stay on the form below.
 */
export async function OneTap({
  slug,
  campaign,
  card,
  locale,
  failed,
}: {
  slug: string;
  campaign: PublicCampaignDto;
  card: { brand: string | null; last4: string | null };
  locale: string;
  failed: boolean;
}) {
  const t = await getTranslations('savedCard');
  const key = randomUUID();
  const label = { brand: card.brand ?? t('card'), last4: card.last4 ?? '' };
  return (
    <section className={giveCard} aria-labelledby="one-tap-title">
      <h2 id="one-tap-title" className="m-0 text-card text-ink">
        {t('oneTapTitle')}
      </h2>
      <p className="m-0 text-body text-ink-2">{t('oneTapBody', label)}</p>
      {failed ? <Alert title={t('oneTapFailed')} /> : null}
      {campaign.levels.map((l) => (
        <form key={l.id} action={giveWithCardAction.bind(null, slug, campaign.id, key, l.id)}>
          <Button type="submit" size="lg" className="w-full">
            {t('oneTapGive', {
              amount: formatMoney(money(l.amountMinor, campaign.currency), locale),
              name: l.name,
            })}
          </Button>
        </form>
      ))}
      <Link href={`/events/${slug}/card`} className="text-body font-semibold text-primary underline">
        {t('manageCard')}
      </Link>
    </section>
  );
}
