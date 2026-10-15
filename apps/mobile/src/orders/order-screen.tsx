/**
 * One order (M7.3c): the confirmation after a purchase and the receipt afterwards. Lines, totals in the
 * event's currency, the refund policy it was bought under and where a refund request stands.
 *
 * `placed` comes from checkout: `1` for an order the provider confirmed, `pending` for one the person
 * paid but the provider has not confirmed yet. `/v1/me/orders` shows an order once it is paid, so a
 * pending one answers "not found" for a few seconds; the screen keeps asking, then stops after two
 * minutes and says where to look later.
 */
import { ROUTES, space, useColors } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { type MyOrder, useMyOrder } from '../shop/api';
import { failureOf } from '../shop/errors';
import { formatEventStart, formatEventWhen, formatMoney } from '../shop/format';
import { Banner, Body, Button, Caption, Card, Empty, Heading, Loading, Page } from '../shop/ui';
import { statusTone } from './status';

export const POLL_LIMIT_MS = 2 * 60_000;

function Money({
  label,
  minor,
  order,
  strong = false,
}: {
  label: string;
  minor: number;
  order: MyOrder;
  strong?: boolean;
}) {
  const locale = useLocale();
  return (
    <View style={styles.line}>
      <Body strong={strong}>{label}</Body>
      <Body strong={strong}>{formatMoney(minor, order.currency, locale)}</Body>
    </View>
  );
}

function RefundCard({ order }: { order: MyOrder }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const policy = order.refundPolicy;
  const latest = order.refundRequest.latest;
  const deadline = order.refundRequest.deadline ?? policy?.deadline ?? null;
  const policyText = !policy
    ? null
    : policy.kind === 'none'
      ? t('refund.policyNone')
      : policy.kind === 'always'
        ? t('refund.policyAlways')
        : deadline
          ? t('refund.policyUntil', { date: formatEventStart(deadline, policy.timezone, locale) })
          : t('refund.policyAlways');
  return (
    <Card testID="order-refund">
      <Heading level={2}>{t('refund.title')}</Heading>
      {policyText ? <Body testID="order-refund-policy">{policyText}</Body> : null}
      {latest ? (
        <Banner
          tone={latest.status === 'approved' ? 'success' : latest.status === 'declined' ? 'danger' : 'info'}
          title={t(`refund.status.${latest.status}`)}
          testID="order-refund-status"
        >
          {t('refund.requested', { count: latest.tickets })}
          {latest.status === 'declined' && latest.declineReason ? `\n${latest.declineReason}` : ''}
        </Banner>
      ) : (
        <Body muted>{t('refund.none')}</Body>
      )}
    </Card>
  );
}

export function OrderScreen({ id, placed }: { id: string; placed: 'confirmed' | 'pending' | null }) {
  const t = useTranslations('orders');
  const core = useTranslations('core');
  const locale = useLocale();
  const router = useRouter();
  const colors = useColors();

  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (placed !== 'pending') return;
    const timer = setTimeout(() => setGaveUp(true), POLL_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [placed]);

  const query = useMyOrder(id, placed === 'pending' && !gaveUp);
  const order = query.data;
  const failure = query.isError ? failureOf(query.error) : null;

  const back = (
    <Button
      tone="secondary"
      label={t('back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      testID="order-back"
    />
  );

  if (!order) {
    if (query.isPending) {
      return (
        <Page>
          <Loading label={t('loading')} />
        </Page>
      );
    }
    // A just-paid order is not listed until the provider confirms it.
    if (placed === 'pending' && failure?.kind === 'not_found') {
      return (
        <Page edges={['top']}>
          {back}
          <Banner
            tone="info"
            title={gaveUp ? t('processing.stillTitle') : t('processing.title')}
            heading
            testID="order-processing"
            action={
              gaveUp ? (
                <Button
                  label={t('processing.viewOrders')}
                  onPress={() => router.replace('/orders')}
                  testID="order-view-orders"
                />
              ) : undefined
            }
          >
            {gaveUp ? t('processing.stillBody') : t('processing.body')}
          </Banner>
          {gaveUp ? null : <Loading label={t('processing.waiting')} testID="order-waiting" />}
        </Page>
      );
    }
    return (
      <Page edges={['top']}>
        {back}
        {failure?.kind === 'not_found' ? (
          <Empty testID="order-not-found" title={t('notFoundTitle')} body={t('notFoundBody')} />
        ) : (
          <Banner
            tone="danger"
            title={t('errorTitle')}
            heading
            testID="order-error"
            action={<Button label={core('common.retry')} onPress={() => void query.refetch()} />}
          >
            {failure?.kind === 'network'
              ? core('errors.network')
              : failure?.kind === 'unauthenticated'
                ? t('signInAgain')
                : core('errors.generic')}
          </Banner>
        )}
      </Page>
    );
  }

  const tone = statusTone(order.status);
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} testID="order-scroll">
        {back}
        {placed && order.status === 'paid' ? (
          <Banner
            tone="success"
            title={t('confirmed.title')}
            testID="order-confirmed"
            action={
              <Button
                label={t('confirmed.action')}
                onPress={() => router.push('/tickets')}
                testID="order-view-tickets"
              />
            }
          >
            {t('confirmed.body')}
          </Banner>
        ) : null}

        <Heading>{order.event.name}</Heading>
        <Body>{formatEventWhen(order.event.startsAt, order.event.endsAt, order.event.timezone, locale)}</Body>
        <Body muted>{order.organizerName}</Body>
        <Body strong testID="order-status">
          {tone === 'ok' ? '✓ ' : tone === 'bad' ? '✕ ' : '… '}
          {t(`status.${order.status}`)}
        </Body>

        <Card testID="order-lines">
          <Heading level={2}>{t('lines')}</Heading>
          {order.items.map((line) => (
            <View key={line.ticketTypeId} style={styles.line}>
              <Body testID={`order-line-${line.ticketTypeId}`}>
                {t('line', { quantity: line.quantity, name: line.name })}
              </Body>
              <Body>
                {line.unitAllInMinor * line.quantity === 0
                  ? t('free')
                  : formatMoney(line.unitAllInMinor * line.quantity, order.currency, locale)}
              </Body>
            </View>
          ))}
          <View style={[styles.totals, { borderColor: colors.line }]}>
            <Money label={t('subtotal')} minor={order.subtotalMinor} order={order} />
            {order.discountMinor > 0 ? (
              <Money label={t('discount')} minor={-order.discountMinor} order={order} />
            ) : null}
            {order.feeMinor > 0 ? <Money label={t('fees')} minor={order.feeMinor} order={order} /> : null}
            <View testID="order-total">
              <Money label={t('total')} minor={order.totalMinor} order={order} strong />
            </View>
          </View>
        </Card>

        <Card>
          <Caption>
            {t('ordered', { date: formatEventStart(order.createdAt, order.event.timezone, locale) })}
          </Caption>
          {order.paidAt ? (
            <Caption>
              {t('paidOn', { date: formatEventStart(order.paidAt, order.event.timezone, locale) })}
            </Caption>
          ) : null}
          <Caption>{t('tickets', { count: order.ticketIds.length })}</Caption>
          {order.transferred > 0 ? <Caption>{t('transferred', { count: order.transferred })}</Caption> : null}
          <Caption>{t('orderRef', { ref: order.id.slice(0, 8).toUpperCase() })}</Caption>
        </Card>

        <RefundCard order={order} />

        <Button
          tone="secondary"
          label={t('viewEvent')}
          onPress={() => router.push({ pathname: ROUTES.event, params: { slug: order.event.slug } })}
          testID="order-view-event"
        />
        <Button
          tone="secondary"
          label={t('viewTickets')}
          onPress={() => router.push('/tickets')}
          testID="order-tickets"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[10] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3] },
  totals: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[2], gap: space[1] },
});
