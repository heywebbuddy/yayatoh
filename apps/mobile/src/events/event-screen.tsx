/**
 * An event's page (M7.3c): what, when in the event's time zone, where (with a maps link), the
 * organizer's colours through the theme, the dates of a multi-date event and the ticket types with
 * all-in prices and availability. Choosing tickets follows the web's rules (`shop/selection.ts`);
 * "Continue" takes the cart to the checkout screen.
 *
 * Passes that give access to a live stream are never sold here (P7-7, App Review 3.1.3): an online
 * event shows "Buy on the web" in place of the stepper, and a hybrid event learns which passes are
 * streamed from the server's `buy_on_web` answer.
 *
 * This is also where the checkout's return and cancel links land (`?checkout=return|cancelled`).
 */
import { BrandScope, ROUTES, space, useColors, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { useCheckout } from '../checkout/use-checkout';
import {
  type EventDate,
  type Section,
  useEventDates,
  useEventSections,
  usePasses,
  usePublicEvent,
  useVenue,
  useWebBaseUrl,
} from '../shop/api';
import { updateCart, useCartEntry } from '../shop/cart-store';
import { failureOf } from '../shop/errors';
import type { CheckoutReturn } from '../shop/event-links';
import { formatEventStart, formatEventWhen, formatMoney } from '../shop/format';
import { useShopPorts } from '../shop/ports';
import { cartIssues, passStatus, stepQuantity, summarize, withQuantity } from '../shop/selection';
import { brandColorOf, mapLinkFor, plainText } from '../shop/text';
import { Banner, Body, Button, Caption, Card, Chip, Empty, Heading, Loading, Page } from '../shop/ui';
import { PassRow } from './pass-row';

export interface ReturnMarker {
  readonly outcome: CheckoutReturn;
  readonly orderId: string | null;
}

export function EventScreen({ slug, marker }: { slug: string; marker: ReturnMarker | null }) {
  const event = usePublicEvent(slug);
  const brand = brandColorOf(event.data);
  return (
    <BrandScope color={brand}>
      <EventBody slug={slug} marker={marker} eventQuery={event} />
    </BrandScope>
  );
}

function BackButton() {
  const t = useTranslations('discover.event');
  const router = useRouter();
  return (
    <Button
      tone="secondary"
      label={t('back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover'))}
      testID="event-back"
    />
  );
}

function textSections(sections: readonly Section[] | undefined) {
  return (sections ?? []).flatMap((s) =>
    s.kind === 'text' ? [{ id: s.id, title: s.title, body: plainText(s.content.markdown) }] : [],
  );
}

function EventBody({
  slug,
  marker,
  eventQuery,
}: {
  slug: string;
  marker: ReturnMarker | null;
  eventQuery: ReturnType<typeof usePublicEvent>;
}) {
  const t = useTranslations('discover.event');
  const ct = useTranslations('checkout');
  const core = useTranslations('core');
  const locale = useLocale();
  const colors = useColors();
  const router = useRouter();
  const ports = useShopPorts();
  const session = useSession();
  const entry = useCartEntry(slug);

  const webBase = useWebBaseUrl().data ?? null;
  const passesQuery = usePasses(slug);
  const datesQuery = useEventDates(slug);
  const sectionsQuery = useEventSections(slug);
  const venueQuery = useVenue(eventQuery.data?.venueSlug ?? null);
  const checkout = useCheckout({ slug, webBase, fallbackReturn: `yayatoh://events/${slug}` });

  const [needDate, setNeedDate] = useState(false);

  // The return and cancel links: once per link.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!marker?.orderId) return;
    const id = `${marker.outcome}:${marker.orderId}`;
    if (handled.current === id) return;
    handled.current = id;
    void checkout.resume(marker.orderId, marker.outcome);
  }, [marker, checkout.resume]);

  const state = checkout.state;
  useEffect(() => {
    if (state.phase === 'done')
      router.replace({
        pathname: ROUTES.order,
        params: { id: state.orderId, placed: state.settled ? '1' : 'pending' },
      });
  }, [state, router]);

  const event = eventQuery.data;
  const passes = passesQuery.data ?? [];
  const dates = useMemo<EventDate[]>(
    () => (datesQuery.data ?? []).filter((d) => d.status !== 'cancelled'),
    [datesQuery.data],
  );
  const webOnly = useMemo(() => new Set(entry.webOnly), [entry.webOnly]);
  const online = event?.attendanceMode === 'online';
  const webEventUrl = useMemo(() => {
    if (!webBase) return null;
    const q = new URLSearchParams({ utm_source: 'yayatoh-app', utm_medium: 'app' });
    if (entry.occurrenceId) q.set('date', entry.occurrenceId);
    return `${webBase.replace(/\/+$/, '')}/events/${slug}?${q}`;
  }, [webBase, slug, entry.occurrenceId]);

  const summary = useMemo(() => summarize(passes, entry.cart), [passes, entry.cart]);
  const issues = useMemo(
    () => cartIssues(passes, entry.cart, webOnly, online),
    [passes, entry.cart, webOnly, online],
  );
  const blocking = issues.filter((i) => i.kind !== 'empty');

  if (eventQuery.isPending) {
    return (
      <Page>
        <Loading label={t('loading')} />
      </Page>
    );
  }
  if (eventQuery.isError || !event) {
    const failure = failureOf(eventQuery.error);
    const missing = failure.kind === 'not_found';
    return (
      <Page>
        <BackButton />
        {missing ? (
          <Empty testID="event-not-found" title={t('notFoundTitle')} body={t('notFoundBody')} />
        ) : (
          <Banner
            tone="danger"
            title={t('errorTitle')}
            heading
            testID="event-error"
            action={<Button label={core('common.retry')} onPress={() => void eventQuery.refetch()} />}
          >
            {failure.kind === 'network' ? core('errors.network') : core('errors.generic')}
          </Banner>
        )}
      </Page>
    );
  }

  const venue = venueQuery.data;
  const mapLink = venue ? mapLinkFor(venue) : null;
  const sections = textSections(sectionsQuery.data);
  const location = (sectionsQuery.data ?? []).find((s) => s.kind === 'location');
  const buyable = event.status === 'published';
  const needsDate = dates.length > 0 && !entry.occurrenceId;
  const cancelledMarker =
    state.phase === 'cancelled' || (marker?.outcome === 'cancelled' && marker.orderId === null);

  const change = (passId: string, direction: 1 | -1) => {
    const pass = passes.find((p) => p.id === passId);
    if (!pass) return;
    setNeedDate(false);
    updateCart(slug, {
      cart: withQuantity(entry.cart, pass, stepQuantity(pass, entry.cart[passId] ?? 0, direction)),
    });
  };

  const goToCheckout = () => {
    if (needsDate) {
      setNeedDate(true);
      return;
    }
    router.push({ pathname: '/checkout/[slug]', params: { slug } });
  };

  const openWeb = () => {
    if (webEventUrl) void ports.browser.openWeb(webEventUrl);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="event-scroll"
      >
        <BackButton />

        {state.phase === 'confirming' ? (
          <Banner tone="info" title={ct('confirmingTitle')} live testID="event-confirming">
            {ct('confirmingBody')}
          </Banner>
        ) : null}
        {cancelledMarker ? (
          <Banner tone="warning" title={ct('cancelledTitle')} testID="event-cancelled">
            {ct('cancelledBody')}
          </Banner>
        ) : null}

        <View style={styles.titleBlock}>
          <Heading>{event.name}</Heading>
          {event.tagline ? <Body muted>{event.tagline}</Body> : null}
          <Body strong>{t('by', { organizer: event.organizerName })}</Body>
        </View>

        {event.status === 'cancelled' ? (
          <Banner tone="danger" title={t('statusCancelled')} />
        ) : event.status === 'postponed' ? (
          <Banner tone="warning" title={t('statusPostponed')} />
        ) : event.status === 'completed' || event.status === 'archived' ? (
          <Banner tone="info" title={t('statusEnded')} />
        ) : null}

        <Card>
          <Caption>{t('when')}</Caption>
          <Body strong testID="event-when">
            {formatEventWhen(event.startsAt, event.endsAt, event.timezone, locale)}
          </Body>
          <Caption>{t('timezone', { zone: event.timezone })}</Caption>
          <Caption>{t('where')}</Caption>
          <Body strong testID="event-where">
            {event.attendanceMode === 'online'
              ? t('onlineEvent')
              : [event.venueName, event.city].filter(Boolean).join(', ') || t('placeToBeAnnounced')}
          </Body>
          {event.attendanceMode === 'hybrid' ? <Body muted>{t('hybridNote')}</Body> : null}
          {location?.kind === 'location' && location.content.address ? (
            <Body muted>{location.content.address}</Body>
          ) : null}
          {venue?.accessibilityNotes ? <Body muted>{venue.accessibilityNotes}</Body> : null}
          {mapLink && event.attendanceMode !== 'online' ? (
            <Button
              tone="secondary"
              label={t('openMaps')}
              onPress={() => void ports.browser.openExternal(mapLink)}
              testID="open-maps"
            />
          ) : null}
        </Card>

        {sections.map((s) => (
          <Card key={s.id}>
            <Heading level={2}>{s.title || t('about')}</Heading>
            <Body>{s.body}</Body>
          </Card>
        ))}

        {buyable && dates.length > 0 ? (
          <View style={styles.block} testID="date-picker">
            <Heading level={2}>{t('chooseDate')}</Heading>
            <View style={styles.wrap}>
              {dates.map((d) => (
                <Chip
                  key={d.id}
                  testID={`date-${d.id}`}
                  label={`${formatEventStart(d.startsAt, event.timezone, locale)}${d.soldOut ? ` · ${t('soldOut')}` : ''}`}
                  selected={entry.occurrenceId === d.id}
                  onPress={() => {
                    setNeedDate(false);
                    if (!d.soldOut)
                      updateCart(slug, { occurrenceId: entry.occurrenceId === d.id ? null : d.id });
                  }}
                />
              ))}
            </View>
            {needDate ? (
              <Banner tone="warning" title={t('chooseDateFirst')} testID="choose-date-error" />
            ) : null}
          </View>
        ) : null}

        <View style={styles.block}>
          <Heading level={2}>{t('tickets')}</Heading>
          {event.attendanceMode === 'hybrid' ? <Caption>{t('webOnly.hybridNote')}</Caption> : null}
          {online ? (
            <Banner tone="info" title={t('webOnly.title')} testID="web-only-banner">
              {t('webOnly.body')}
            </Banner>
          ) : null}
          {!buyable ? (
            <Body muted>{t('notOnSale')}</Body>
          ) : passesQuery.isPending ? (
            <Loading label={t('loadingTickets')} testID="loading-tickets" />
          ) : passesQuery.isError ? (
            <Banner
              tone="danger"
              title={t('ticketsError')}
              testID="tickets-error"
              action={<Button label={core('common.retry')} onPress={() => void passesQuery.refetch()} />}
            >
              {failureOf(passesQuery.error).kind === 'network'
                ? core('errors.network')
                : core('errors.generic')}
            </Banner>
          ) : passes.length === 0 ? (
            <Body muted testID="no-passes">
              {t('noTickets')}
            </Body>
          ) : (
            passes.map((pass) => (
              <PassRow
                key={pass.id}
                pass={pass}
                status={passStatus(pass, webOnly, online)}
                quantity={entry.cart[pass.id] ?? 0}
                timeZone={event.timezone}
                onChange={(dir) => change(pass.id, dir)}
                onBuyOnWeb={openWeb}
              />
            ))
          )}
          {webOnly.size > 0 && !online ? (
            <Banner tone="info" title={t('webOnly.title')} testID="web-only-hybrid">
              {t('webOnly.body')}
            </Banner>
          ) : null}
        </View>
      </ScrollView>

      {summary.count > 0 ? (
        <View
          style={[styles.bar, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
          testID="cart-bar"
        >
          <Body strong testID="cart-summary">
            {t('cartSummary', {
              count: summary.count,
              total:
                summary.totalMinor === 0
                  ? t('free')
                  : formatMoney(summary.totalMinor, summary.currency ?? event.currency, locale),
            })}
          </Body>
          {blocking.length > 0 ? <Caption>{t('cartIssue')}</Caption> : null}
          <Button
            label={t('continue')}
            onPress={goToCheckout}
            disabled={blocking.length > 0 || session.status === 'loading'}
            testID="continue-to-checkout"
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  titleBlock: { gap: space[1] },
  block: { gap: space[3] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, padding: space[4], gap: space[2] },
});
