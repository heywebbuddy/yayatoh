/**
 * One ticket (M7.3b): the QR code at full brightness, the short code, the holder, seat and entrances,
 * the event in its own time zone, the venue, the organizer's branding, and what the holder can do
 * with it (calendar, directions, wallet, transfer, refund). Opens from the encrypted cache with the
 * network off.
 */
import { BrandScope, space, useColors, useIsOffline } from '@yayatoh/mobile-core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import { isNotFound, type Ticket, ticketKeys, viewProblem } from '../api';
import { formatEventRange, formatMoment, spellOut } from '../format';
import { useCancelTransfer, useTicket, useWalletLink } from '../hooks';
import { hrefs } from '../nav';
import { TicketQr } from '../qr';
import { type MapsTarget, useTicketServices } from '../services';
import { BackBar, Banner, Body, Button, Caption, Card, EmptyState, Fact, Heading, Loading, Screen } from '../ui';
import { useCore } from '@yayatoh/mobile-core';

const QR_MAX = 340;

const addressOf = (venue: NonNullable<Ticket['venue']>): string | null => {
  const line = [venue.addressLine1, venue.addressLine2, venue.city, venue.region, venue.postalCode, venue.country]
    .filter((p): p is string => Boolean(p))
    .join(', ');
  return line || null;
};

function mapsTargetOf(ticket: Ticket): MapsTarget | null {
  if (ticket.venue)
    return {
      label: ticket.venue.name,
      address: addressOf(ticket.venue),
      latitude: ticket.venue.latitude,
      longitude: ticket.venue.longitude,
      mapUrl: ticket.venue.mapUrl,
    };
  if (ticket.event.venueName)
    return {
      label: ticket.event.venueName,
      address: [ticket.event.city, ticket.event.country].filter(Boolean).join(', ') || null,
      latitude: null,
      longitude: null,
      mapUrl: null,
    };
  return null;
}

export function TicketDetailScreen({ id }: { id: string }) {
  const t = useTranslations('tickets');
  const router = useRouter();
  const core = useCore();
  const query = useTicket(id);
  const ticket = query.data;

  // A ticket that is no longer the person's (transferred away, refunded) is dropped from the cache.
  const gone = isNotFound(query.error);
  useEffect(() => {
    if (gone) core.queryClient.removeQueries({ queryKey: ticketKeys.detail(id) });
  }, [gone, core, id]);

  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.tickets()));

  if (gone) {
    return (
      <Screen testID="ticket-screen">
        <BackBar label={t('common.back')} onBack={back} />
        <EmptyState
          testID="ticket-gone"
          title={t('common.notFoundTitle')}
          body={t('common.notFoundBody')}
          action={<Button label={t('common.toMyTickets')} onPress={() => router.replace(hrefs.tickets())} />}
        />
      </Screen>
    );
  }
  if (!ticket) {
    return (
      <Screen testID="ticket-screen">
        <BackBar label={t('common.back')} onBack={back} />
        {query.isPending && query.fetchStatus !== 'paused' ? (
          <Loading label={t('detail.loading')} />
        ) : (
          <EmptyState
            testID="ticket-error"
            title={t('detail.loadFailed')}
            body={query.fetchStatus === 'paused' ? t('list.offlineNothing') : undefined}
            action={<Button label={t('common.retry')} onPress={() => void query.refetch()} testID="retry" />}
          />
        )}
      </Screen>
    );
  }
  return (
    <BrandScope color={ticket.branding.accentColor ?? ticket.accentColor}>
      <TicketBody ticket={ticket} updatedAt={query.dataUpdatedAt} refreshFailed={query.isError} onBack={back} />
    </BrandScope>
  );
}

function TicketBody({
  ticket,
  updatedAt,
  refreshFailed,
  onBack,
}: {
  ticket: Ticket;
  updatedAt: number;
  refreshFailed: boolean;
  onBack: () => void;
}) {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const colors = useColors();
  const router = useRouter();
  const offline = useIsOffline();
  const services = useTicketServices();
  const { width } = useWindowDimensions();
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const span = ticket.date ?? ticket.event;
  const active = ticket.status === 'active';
  const ended = new Date(span.endsAt).getTime() <= services.now().getTime();
  const showQr = active && ticket.qrCode !== null;
  const qrSize = Math.max(160, Math.min(QR_MAX, width - space[4] * 4));

  // Full brightness while the code is on the screen; the person's own level comes back on leaving.
  useFocusEffect(
    useCallback(() => {
      if (!showQr) return undefined;
      let release: (() => void) | null = null;
      let cancelled = false;
      void services.boostBrightness().then((restore) => {
        if (cancelled) restore();
        else release = restore;
      });
      return () => {
        cancelled = true;
        release?.();
      };
    }, [showQr, services]),
  );

  const cancel = useCancelTransfer(ticket.id);
  const wallet = useWalletLink(ticket.id);
  const when = formatEventRange(format, span.startsAt, span.endsAt, ticket.event.timezone, t('common.rangeSeparator'));
  const target = mapsTargetOf(ticket);
  const platform = Platform.OS === 'ios' ? 'apple' : 'google';

  const addToCalendar = async () => {
    const outcome = await services.addToCalendar({
      title: ticket.event.name,
      startsAt: new Date(span.startsAt),
      endsAt: new Date(span.endsAt),
      location: target ? [target.label, target.address].filter(Boolean).join(', ') : null,
      notes: `${ticket.ticketTypeName} · ${ticket.organizerName}`,
    });
    setNotice(
      outcome === 'added'
        ? { tone: 'success', text: t('detail.calendarAdded') }
        : outcome === 'cancelled'
          ? { tone: 'warning', text: t('detail.calendarCancelled') }
          : outcome === 'denied'
            ? { tone: 'warning', text: t('detail.calendarDenied') }
            : { tone: 'danger', text: t('detail.calendarFailed') },
    );
  };

  const openDirections = async () => {
    if (!target) return;
    const ok = await services.openMaps(target);
    if (!ok) setNotice({ tone: 'danger', text: t('detail.directionsFailed') });
  };

  const addToWallet = () => {
    if (offline) {
      setNotice({ tone: 'warning', text: t('detail.walletOffline') });
      return;
    }
    wallet.mutate(
      { platform },
      {
        onSuccess: async (link) => {
          const ok = await services.openWalletLink(link.url);
          if (!ok) setNotice({ tone: 'danger', text: t('detail.walletFailed') });
        },
        onError: (error) =>
          setNotice({
            tone: 'danger',
            text: viewProblem(error).status === 404 ? t('detail.walletUnavailable') : t('detail.walletFailed'),
          }),
      },
    );
  };

  const doCancel = (transferId: string) =>
    cancel.mutate(
      { transferId },
      {
        onSuccess: () => {
          setConfirmingCancel(false);
          setNotice({ tone: 'success', text: t('detail.cancelled') });
        },
        onError: () => setNotice({ tone: 'danger', text: t('detail.cancelFailed') }),
      },
    );

  const pendingTo = ticket.transfer.pendingTransferTo ?? '';
  const refusal = ticket.transfer.reason;
  const deadline = formatMoment(format, ticket.transfer.deadline, ticket.event.timezone);

  return (
    <Screen testID="ticket-screen">
      <BackBar label={t('common.back')} onBack={onBack} />
      <Heading>{ticket.event.name}</Heading>
      <Caption>{t('detail.presentedBy', { name: ticket.branding.organizerName })}</Caption>

      {offline ? (
        <Banner tone="info" testID="offline-copy">
          {t('detail.offlineCopy')}
        </Banner>
      ) : refreshFailed ? (
        <Banner tone="warning" testID="update-failed">
          {t('detail.updateFailed')}
        </Banner>
      ) : null}
      {!active ? (
        <Banner tone="danger" title={t('detail.void')} testID="void-banner">
          {t('detail.voidBody')}
        </Banner>
      ) : ended ? (
        <Banner tone="info" title={t('detail.ended')} testID="ended-banner">
          {t('detail.endedBody')}
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone={notice.tone} testID="notice">
          {notice.text}
        </Banner>
      ) : null}

      <Card testID="qr-card">
        {showQr && ticket.qrCode ? (
          <View style={styles.qr}>
            <TicketQr
              code={ticket.qrCode}
              size={qrSize}
              label={t('detail.qrLabel', { event: ticket.event.name })}
            />
            <Caption>{t('detail.qrHint')}</Caption>
          </View>
        ) : (
          <Body tone="ink2" testID="qr-unavailable">
            {t('detail.qrUnavailable')}
          </Body>
        )}
        <View
          accessible
          accessibilityLabel={t('detail.shortCodeLabel', { code: spellOut(ticket.shortCode) })}
          style={styles.codeBox}
          testID="short-code"
        >
          <Caption>{t('detail.shortCode')}</Caption>
          <Text style={[styles.code, { color: colors.ink }]} maxFontSizeMultiplier={1.6}>
            {ticket.shortCode}
          </Text>
        </View>
      </Card>

      <Card>
        <Fact label={t('detail.holder')} value={ticket.holderName} testID="fact-holder" />
        <Fact label={t('detail.type')} value={ticket.ticketTypeName} testID="fact-type" />
        {ticket.seatLabel ? <Fact label={t('detail.seat')} value={ticket.seatLabel} testID="fact-seat" /> : null}
        {ticket.checkpoints.length > 0 ? (
          <Fact
            label={t('detail.entrances')}
            value={ticket.checkpoints
              .map((c) => t(c.kind === 'entrance' ? 'detail.entrance' : 'detail.zone', { name: c.name }))
              .join('\n')}
            testID="fact-entrances"
          />
        ) : null}
        <Fact label={t('detail.when')} value={when} testID="fact-when" />
        <Fact
          label={t('detail.where')}
          value={
            target
              ? [target.label, target.address].filter(Boolean).join('\n')
              : t('detail.venueUnknown')
          }
          testID="fact-where"
        />
        {ticket.venue?.accessibilityNotes ? (
          <Fact label={t('detail.accessibility')} value={ticket.venue.accessibilityNotes} />
        ) : null}
      </Card>

      {ticket.branding.logoUrl ? (
        <Image
          source={{ uri: ticket.branding.logoUrl }}
          accessibilityLabel={ticket.branding.logoAlt ?? ticket.branding.organizerName}
          accessibilityRole="image"
          resizeMode="contain"
          style={styles.logo}
          testID="organizer-logo"
        />
      ) : null}

      <View style={styles.actions}>
        {active && !ended ? (
          <Button label={t('detail.calendar')} variant="secondary" onPress={() => void addToCalendar()} testID="add-calendar" />
        ) : null}
        {target ? (
          <Button label={t('detail.directions')} variant="secondary" onPress={() => void openDirections()} testID="directions" />
        ) : null}
        {active ? (
          <Button
            label={platform === 'apple' ? t('detail.walletApple') : t('detail.walletGoogle')}
            variant="secondary"
            busy={wallet.isPending}
            onPress={addToWallet}
            testID="add-wallet"
          />
        ) : null}
      </View>

      {active && !ended ? (
        <Card testID="transfer-card">
          {ticket.transfer.pendingTransferId ? (
            <>
              <Banner tone="warning" title={t('detail.transferPendingTitle')} role="summary" testID="transfer-pending">
                {t('detail.transferPendingBody', { name: pendingTo })}
              </Banner>
              {confirmingCancel ? (
                <>
                  <Body>{t('detail.cancelTransferConfirm', { name: pendingTo })}</Body>
                  <Button
                    label={t('detail.cancelTransferDo')}
                    variant="danger"
                    busy={cancel.isPending}
                    onPress={() => doCancel(ticket.transfer.pendingTransferId as string)}
                    testID="cancel-transfer-confirm"
                  />
                  <Button
                    label={t('detail.cancelTransferKeep')}
                    variant="secondary"
                    onPress={() => setConfirmingCancel(false)}
                    testID="cancel-transfer-keep"
                  />
                </>
              ) : (
                <Button
                  label={t('detail.cancelTransfer')}
                  variant="secondary"
                  onPress={() => setConfirmingCancel(true)}
                  testID="cancel-transfer"
                />
              )}
            </>
          ) : ticket.transfer.allowed ? (
            <>
              <Button
                label={t('detail.transfer')}
                variant="secondary"
                onPress={() => router.push(hrefs.transfer(ticket.id))}
                testID="transfer"
              />
              <Caption>{t('detail.transferUntil', { deadline })}</Caption>
            </>
          ) : refusal && refusal !== 'ticket_void' && refusal !== 'event_ended' ? (
            <Caption testID="transfer-refused">{t(`detail.transferRefused.${refusal}`, { deadline })}</Caption>
          ) : null}
        </Card>
      ) : null}

      {active ? (
        <Button
          label={t('detail.refund')}
          variant="secondary"
          onPress={() => router.push(hrefs.refund(ticket.id))}
          testID="refund"
        />
      ) : null}

      <Caption testID="synced-at">
        {t('common.syncedAt', {
          when: format.dateTime(new Date(updatedAt), { dateStyle: 'medium', timeStyle: 'short' }),
        })}
      </Caption>
      {ticket.branding.poweredByVisible ? <Caption>{t('common.poweredBy')}</Caption> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', gap: space[3] },
  codeBox: { alignItems: 'center', gap: space[1] },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  actions: { gap: space[2] },
  logo: { height: 48, width: 160, alignSelf: 'flex-start' },
});
