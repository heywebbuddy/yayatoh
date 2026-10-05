import { randomUUID } from 'node:crypto';
import { publicGiving, savedCardView } from '@yayatoh/donations';
import { Alert, Button, buttonClass, EmptyState, Label } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { deviceCardToken } from '@/server/saved-card.ts';
import { GiveFrame, GiveHero, giveCard } from '../give/give-frame.tsx';
import { type CardTarget, removeCardAction, saveCardAction } from './actions.ts';
import { CardForm } from './card-form.tsx';

/**
 * The card page (M4.8e, P4-14), phone-first, opened from a QR code at check-in or on the table, a
 * party's own link, or the checkout box. Opt-in only: this device's card for tonight's giving at
 * this event. With an active card it says which one and offers giving and removal; otherwise the
 * form. Only when the org takes gifts online (a connected account) and a campaign is open.
 */
export async function CardPage(props: {
  orgId: string;
  eventId: string;
  eventName: string;
  organizer: string;
  slug: string;
  target: CardTarget;
  partyName?: string | null;
  saved: boolean;
  removed: boolean;
}) {
  const t = await getTranslations('savedCard');
  const giving = await publicGiving(props.orgId, props.eventId);
  const token = await deviceCardToken(props.eventId);
  const card = token ? await savedCardView(props.orgId, token) : null;
  const mine = card && card.eventId === props.eventId ? card : null;
  const open = giving.available && giving.campaigns.length > 0;
  return (
    <GiveFrame organizer={props.organizer}>
      <GiveHero>
        <Label tone="inverse">{props.eventName}</Label>
        <h1 className="m-0 text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] md:text-title">
          {t('title')}
        </h1>
        <p className="m-0 text-[15px] leading-relaxed text-white/90">
          {props.partyName ? t('introParty', { party: props.partyName }) : t('intro')}
        </p>
      </GiveHero>
      {props.removed ? <Alert tone="success" title={t('removed')} /> : null}
      {props.target.source === 'checkout' && !props.saved ? (
        <Alert tone="success" title={t('fromCheckout')} />
      ) : null}
      {!open ? (
        <EmptyState title={t('unavailableTitle')} description={t('unavailableBody')} />
      ) : mine?.status === 'active' ? (
        <section className={giveCard} aria-labelledby="card-saved">
          <Alert tone="success" title={t('savedTitle')}>
            <span id="card-saved">
              {t('savedBody', { brand: mine.brand ?? t('card'), last4: mine.last4 ?? '' })}
            </span>
          </Alert>
          <Link href={`/events/${props.slug}/give`} className={buttonClass('primary', 'lg', 'w-full')}>
            {t('giveNow')}
          </Link>
          <form action={removeCardAction.bind(null, props.target)}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('remove')}
            </Button>
          </form>
          <p className="m-0 text-caption text-ink-2">{t('removeHint')}</p>
        </section>
      ) : (
        <>
          {props.saved && mine?.status === 'pending' ? <Alert tone="info" title={t('pending')} /> : null}
          {props.saved && mine?.status === 'failed' ? <Alert title={t('failed')} /> : null}
          <CardForm
            org={props.organizer}
            event={props.eventName}
            action={saveCardAction.bind(null, props.target, randomUUID())}
          />
        </>
      )}
    </GiveFrame>
  );
}
