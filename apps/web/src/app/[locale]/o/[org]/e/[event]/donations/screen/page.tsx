import {
  GIVING_SCREEN_CHANNEL,
  givingQrQuery,
  publicGiving,
  screenSettingsQuery,
  signScreenToken,
} from '@yayatoh/donations';
import { checkoutTarget } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { appTokenSecret, realtimeChannelName } from '@yayatoh/platform';
import { Alert, buttonClass, Card, CardHeader, EmptyState, PageHeader, SectionHeader } from '@yayatoh/ui';
import { MonitorPlay } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { GivingScreen } from '@/components/donations/giving-screen.tsx';
import { Link } from '@/i18n/navigation.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { appOrigin } from '@/server/engagement.ts';
import { ports } from '@/server/ports.ts';
import { RaiseActionButton, RaiseAnnouncer } from '../paddle-raise/action-button.tsx';
import { rotateScreenAction, saveScreenAction } from './actions.ts';
import { ScreenForm } from './screen-form.tsx';
import { ScreenLink } from './screen-link.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.screenPage');
  return { title: t('title') };
}

/**
 * The live screen's console page (M4.8d): choose the campaign the room's thermometer follows and
 * whether donors who asked for it are thanked by name, get the projector's signed link (only
 * `events:write` sees and replaces it), print table cards, and watch a live preview. `orders:read`
 * opens the page.
 */
export default async function ScreenPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('orders:read')) notFound();
  const view = await executeQuery(screenSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.screenPage');
  const tn = await getTranslations('nav');
  const canWrite = can('events:write');
  const base = `/o/${org}/e/${event}/donations`;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const screen = view.screen;
  const campaign = screen ? view.campaigns.find((c) => c.id === screen.campaignId) : undefined;
  const link =
    screen && canWrite
      ? `${appOrigin()}${prefix}/giving-screen/${signScreenToken(
          { orgId: data.org.id, eventId: ev.id, version: screen.version },
          appTokenSecret(),
        )}`
      : null;
  // The QR code opens the campaign's giving page only when it takes gifts (P4-9).
  const giving = screen ? await publicGiving(data.org.id, ev.id) : null;
  const checkout = giving?.available ? await checkoutTarget(view.eventSlug) : null;
  const givingOpen =
    !!screen &&
    !!giving?.campaigns.some((c) => c.id === screen.campaignId) &&
    checkout?.orgId === data.org.id &&
    checkout.eventId === ev.id;
  const giveUrl = screen
    ? `${appOrigin()}/events/${view.eventSlug}/give${givingQrQuery(screen.campaignId, 'screen')}`
    : '';
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: base },
        { label: t('title') },
      ]}
    />
  );
  return (
    <>
      <PageHeader
        breadcrumb={crumbs}
        title={t('title')}
        description={t('subtitle')}
        actions={
          screen ? (
            <Link href={`${base}/screen/cards`} className={buttonClass('secondary', 'md')}>
              {t('cardsLink')}
            </Link>
          ) : null
        }
      />
      <RaiseAnnouncer>
        {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
        {view.campaigns.length === 0 ? (
          <EmptyState
            icon={<MonitorPlay strokeWidth={2} />}
            title={t('noCampaignsTitle')}
            description={t('noCampaignsBody')}
            action={
              <Link href={base} className={buttonClass('primary', 'md')}>
                {t('openDonations')}
              </Link>
            }
          />
        ) : (
          <>
            {canWrite ? (
              <Card size="panel" className="flex flex-col gap-4">
                <CardHeader as="h2" title={screen ? t('settingsTitle') : t('setupTitle')} />
                {screen ? null : <p className="m-0 text-body text-ink-2">{t('setupBody')}</p>}
                <ScreenForm
                  action={saveScreenAction.bind(null, org, event)}
                  campaigns={view.campaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    closed: c.status !== 'open',
                  }))}
                  campaignId={screen?.campaignId ?? null}
                  showNames={screen?.showNames ?? true}
                  setUp={!!screen}
                />
              </Card>
            ) : null}
            {screen ? (
              <>
                {link ? (
                  <Card size="panel" className="flex flex-col gap-4" data-testid="screen-link-card">
                    <CardHeader as="h2" title={t('linkTitle')} />
                    <p className="m-0 text-body text-ink-2">{t('linkBody')}</p>
                    <ScreenLink url={link} />
                    <div className="flex flex-col gap-1.5">
                      <RaiseActionButton
                        action={rotateScreenAction.bind(null, org, event)}
                        label={t('rotate')}
                        className="self-start"
                        testId="rotate-link"
                      />
                      <p className="m-0 text-caption text-ink-2">{t('rotateHint')}</p>
                    </div>
                  </Card>
                ) : null}
                <Card size="panel" className="flex flex-col gap-3" data-testid="screen-giving">
                  <CardHeader as="h2" title={t('givingTitle')} />
                  {givingOpen ? (
                    <p className="m-0 text-body text-ink-2">
                      {t('givingOpen', { campaign: campaign?.name ?? '' })}
                    </p>
                  ) : (
                    <Alert tone="warning" title={t('givingClosed')} />
                  )}
                </Card>
                <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
                  <SectionHeader id="preview-heading" title={t('previewTitle')} />
                  <GivingScreen
                    variant="preview"
                    eventName={ev.name}
                    initial={view.state}
                    streamUrl={realtimeUrl(realtimeChannelName(GIVING_SCREEN_CHANNEL, data.org.id, ev.id))}
                    give={givingOpen ? { url: giveUrl, qr: qrPath(giveUrl) } : null}
                  />
                </section>
              </>
            ) : canWrite ? null : (
              <EmptyState icon={<MonitorPlay strokeWidth={2} />} title={t('notSetUp')} />
            )}
          </>
        )}
      </RaiseAnnouncer>
    </>
  );
}
