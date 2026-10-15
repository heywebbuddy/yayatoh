/**
 * Checkout (M7.3c, `payments`): review the cart, add a promo code, and pay on the provider's hosted
 * page in a secure browser session that returns to the app. Prices shown here are the page's all-in
 * prices; the server prices the cart again and its total is what is charged.
 *
 * Carts the app cannot finish (questions, seats, registration, a transfer fee, a chosen amount) are
 * explained and sent to the web checkout; passes with live-stream access are never bought here.
 */
import { ROUTES, space, useColors, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { usePasses, usePublicEvent, useWebBaseUrl } from '../shop/api';
import { updateCart, useCartEntry } from '../shop/cart-store';
import type { Failure, FailureKind } from '../shop/errors';
import { formatEventWhen, formatMoney } from '../shop/format';
import { cartIssues, summarize } from '../shop/selection';
import { Banner, Body, Button, Caption, Card, Empty, Field, Heading, Loading, Page } from '../shop/ui';
import { useCheckout } from './use-checkout';

const ERROR_KEYS: Readonly<Record<FailureKind, string>> = {
  network: 'errors.network',
  rate_limited: 'errors.rateLimited',
  not_found: 'errors.notFound',
  unauthenticated: 'errors.unauthenticated',
  unverified_email: 'errors.unverifiedEmail',
  risk_blocked: 'errors.riskBlocked',
  org_suspended: 'errors.orgSuspended',
  hold_expired: 'errors.holdExpired',
  buy_on_web: 'errors.unknown',
  idempotency_reused: 'errors.changed',
  promo_invalid: 'errors.promoInvalid',
  sold_out: 'errors.soldOut',
  invalid: 'errors.invalid',
  unknown: 'errors.unknown',
};

export function CheckoutScreen({ slug }: { slug: string }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const colors = useColors();
  const router = useRouter();
  const session = useSession();
  const entry = useCartEntry(slug);
  const event = usePublicEvent(slug);
  const passesQuery = usePasses(slug);
  const webBase = useWebBaseUrl().data ?? null;

  const user = session.status === 'signedIn' ? session.user : null;
  const [name, setName] = useState(user?.name ?? '');
  useEffect(() => {
    if (user?.name) setName((current) => current || (user.name ?? ''));
  }, [user?.name]);

  const checkout = useCheckout({
    slug,
    webBase,
    fallbackReturn: `yayatoh://events/${slug}`,
    name: name.trim() || undefined,
  });
  const state = checkout.state;

  useEffect(() => {
    if (state.phase === 'done')
      router.replace({
        pathname: ROUTES.order,
        params: { id: state.orderId, placed: state.settled ? '1' : 'pending' },
      });
  }, [state, router]);

  const passes = passesQuery.data ?? [];
  const webOnly = useMemo(() => new Set(entry.webOnly), [entry.webOnly]);
  const online = event.data?.attendanceMode === 'online';
  const summary = useMemo(() => summarize(passes, entry.cart), [passes, entry.cart]);
  const issues = useMemo(
    () => cartIssues(passes, entry.cart, webOnly, online),
    [passes, entry.cart, webOnly, online],
  );

  const goBackToEvent = () => router.replace({ pathname: ROUTES.event, params: { slug } });
  const signIn = () => router.push({ pathname: '/', params: { returnTo: `/checkout/${slug}` } });

  if (event.isPending || passesQuery.isPending) {
    return (
      <Page>
        <Loading label={t('loading')} />
      </Page>
    );
  }
  if (event.isError || passesQuery.isError || !event.data) {
    return (
      <Page>
        <Button tone="secondary" label={t('backToEvent')} onPress={goBackToEvent} />
        <Banner tone="danger" title={t('loadErrorTitle')} heading testID="checkout-load-error">
          {t('loadErrorBody')}
        </Banner>
      </Page>
    );
  }

  const eventData = event.data;
  const total = formatMoney(summary.totalMinor, summary.currency ?? eventData.currency, locale);
  const free = summary.totalMinor === 0;
  const working = state.phase === 'starting' || state.phase === 'paying' || state.phase === 'confirming';

  if (issues.length === 1 && issues[0]?.kind === 'empty' && state.phase === 'idle') {
    return (
      <Page>
        <Empty
          testID="checkout-empty"
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={<Button label={t('backToEvent')} onPress={goBackToEvent} />}
        />
      </Page>
    );
  }

  const issueText = issues.map((issue) => {
    if (issue.kind === 'empty') return t('issues.empty');
    const pass = passes.find((p) => p.id === issue.passId);
    const name = pass?.name ?? '';
    switch (issue.kind) {
      case 'unavailable':
        return t('issues.unavailable', { name });
      case 'below_minimum':
        return t('issues.belowMinimum', { name, count: issue.minimum });
      case 'above_maximum':
        return t('issues.aboveMaximum', { name, count: issue.maximum });
      case 'web_only':
        return t('issues.webOnly', { name });
      default:
        return '';
    }
  });

  const failure: Failure | null = state.phase === 'failed' ? state.failure : null;
  const failureText = failure
    ? failure.kind === 'rate_limited'
      ? t('errors.rateLimited', { minutes: Math.max(1, Math.ceil((failure.retryAfter ?? 60) / 60)) })
      : t(ERROR_KEYS[failure.kind])
    : null;
  const needsSignIn = session.status === 'signedOut';
  const unverified = user !== null && user.emailVerified === false;
  const canPay = issues.length === 0 && !working && user !== null && !unverified && state.phase !== 'web';

  const pay = () =>
    void checkout.pay(
      Object.entries(entry.cart)
        .filter(([, q]) => q > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
    );

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button tone="secondary" label={t('backToEvent')} onPress={goBackToEvent} testID="checkout-back" />
        <Heading>{t('title')}</Heading>

        <Card>
          <Body strong>{eventData.name}</Body>
          <Caption>
            {formatEventWhen(eventData.startsAt, eventData.endsAt, eventData.timezone, locale)}
          </Caption>
        </Card>

        <Card testID="checkout-lines">
          <Heading level={2}>{t('yourOrder')}</Heading>
          {summary.lines.map((line) => (
            <View key={line.pass.id} style={styles.line}>
              <Body testID={`line-${line.pass.id}`}>
                {t('line', { quantity: line.quantity, name: line.pass.name })}
              </Body>
              <Body strong>
                {line.lineMinor === 0 ? t('free') : formatMoney(line.lineMinor, line.pass.currency, locale)}
              </Body>
            </View>
          ))}
          <View style={[styles.line, styles.totalLine, { borderColor: colors.line }]}>
            <Body strong>{t('total')}</Body>
            <Body strong testID="checkout-total">
              {free ? t('free') : total}
            </Body>
          </View>
          <Caption>{t('priceNote')}</Caption>
        </Card>

        {issueText.length > 0 ? (
          <Banner tone="warning" title={t('issues.title')} testID="checkout-issues">
            {issueText.join('\n')}
          </Banner>
        ) : null}

        {needsSignIn ? (
          <Banner
            tone="info"
            title={t('signIn.title')}
            testID="checkout-sign-in"
            action={<Button label={t('signIn.action')} onPress={signIn} testID="checkout-sign-in-button" />}
          >
            {t('signIn.body')}
          </Banner>
        ) : null}
        {unverified ? (
          <Banner tone="warning" title={t('errors.unverifiedEmailTitle')} testID="checkout-unverified">
            {t('errors.unverifiedEmail')}
          </Banner>
        ) : null}

        {user ? (
          <Card>
            <Caption>{t('sentTo', { email: user.email })}</Caption>
            <Field
              testID="checkout-name"
              label={t('nameLabel')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={120}
            />
          </Card>
        ) : null}

        {!free ? (
          <Field
            testID="checkout-promo"
            label={t('promoLabel')}
            placeholder={t('promoPlaceholder')}
            value={entry.promoCode}
            onChangeText={(v) => updateCart(slug, { promoCode: v })}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            maxLength={64}
            error={failure?.kind === 'promo_invalid' ? t('errors.promoInvalid') : null}
          />
        ) : null}

        {state.phase === 'web' ? (
          <Banner
            tone="info"
            live
            title={t('web.title')}
            testID="checkout-web"
            action={
              <Button
                label={t('web.action')}
                onPress={() => void checkout.openWeb(state.webUrl)}
                testID="checkout-web-button"
              />
            }
          >
            {t(`web.reason.${state.reason ?? 'other'}`)}
            {'\n'}
            {t('web.keep')}
          </Banner>
        ) : null}

        {state.phase === 'buy_on_web' ? (
          <Banner
            tone="info"
            live
            title={t('buyOnWeb.title')}
            testID="checkout-buy-on-web"
            action={
              state.webUrl ? (
                <Button
                  label={t('buyOnWeb.action')}
                  onPress={() => void checkout.openWeb(state.webUrl ?? '')}
                  testID="checkout-buy-on-web-button"
                />
              ) : null
            }
          >
            {t('buyOnWeb.body')}
          </Banner>
        ) : null}

        {state.phase === 'cancelled' ? (
          <Banner tone="warning" title={t('cancelledTitle')} testID="checkout-cancelled">
            {t('cancelledBody')}
          </Banner>
        ) : null}

        {failureText && failure?.kind !== 'promo_invalid' ? (
          <Banner tone="danger" title={t('errors.title')} testID="checkout-error">
            {failureText}
          </Banner>
        ) : null}

        {state.phase === 'starting' ? (
          <Loading label={t('starting')} testID="checkout-starting" live />
        ) : null}
        {state.phase === 'paying' ? <Loading label={t('paying')} testID="checkout-paying" live /> : null}
        {state.phase === 'confirming' ? (
          <Loading label={t('confirmingTitle')} testID="checkout-confirming" live />
        ) : null}

        <Caption>{t('holdNote')}</Caption>
        <Caption>{t('securePageNote')}</Caption>
      </ScrollView>

      <View style={[styles.bar, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}>
        <Button
          testID="checkout-pay"
          label={state.phase === 'cancelled' ? t('payAgain') : free ? t('getTickets') : t('pay', { total })}
          onPress={pay}
          disabled={!canPay}
          busy={working}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3] },
  totalLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[2] },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, padding: space[4] },
});
