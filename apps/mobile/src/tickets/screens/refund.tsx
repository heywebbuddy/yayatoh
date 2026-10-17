/**
 * Refund requests (M7.3b): the order's refund terms, the status of the latest request, and a form to
 * ask the organizer, exactly as the order panel the API returns allows (`canRequest`, `refusal`).
 * `RefundPanel` is also what the order screen (M7.3c) shows for an order.
 */

import { useQueryClient } from '@tanstack/react-query';
import { space, useColors } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import { type Order, type ProblemView, type Ticket, ticketKeys, viewProblem } from '../api';
import { formatMoment, formatMoney } from '../format';
import { useOrder, useRequestRefund, useTicket } from '../hooks';
import { hrefs } from '../nav';
import {
  BackBar,
  Banner,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Field,
  Heading,
  Loading,
  Screen,
} from '../ui';

/** The message key (under `tickets.refund`) for a failed request. */
export function refundErrorKey(p: ProblemView): string {
  if (p.network) return 'common.network';
  if (p.status === 429) return p.retryAfter ? 'common.rateLimited' : 'common.rateLimitedNoTime';
  if (p.status === 403 && p.reason === 'email_unverified') return 'common.verifyEmail';
  if (p.status === 404) return 'common.notFoundTitle';
  if (p.reason === 'request_open') return 'refund.alreadyOpen';
  if (p.reason === 'policy_window_closed' || p.reason === 'policy_no_refunds') return 'refund.noLonger';
  if (p.code === 'validation_failed') return 'refund.pickOne';
  return 'refund.failed';
}

export function RefundPanel({ order }: { order: Order }) {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const colors = useColors();
  const queryClient = useQueryClient();
  const request = useRequestRefund(order.id);
  const policy = order.refundPolicy;
  const panel = order.refundRequest;
  const zone = order.event.timezone;

  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(order.ticketIds));
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [failureKey, setFailureKey] = useState<{ key: string; seconds: number } | null>(null);
  const [fieldError, setFieldError] = useState<'pickOne' | 'messageTooLong' | null>(null);

  const policyText = !policy
    ? null
    : policy.kind === 'none'
      ? t('refund.policyNone')
      : policy.kind === 'until' && policy.deadline
        ? t('refund.policyUntil', { deadline: formatMoment(format, policy.deadline, zone) })
        : policy.kind === 'until' && policy.daysBefore !== null
          ? t('refund.policyUntilDays', { days: policy.daysBefore })
          : t('refund.policyAlways');

  const submit = () => {
    setFailureKey(null);
    if (chosen.size === 0) return setFieldError('pickOne');
    if (message.trim().length > 1000) return setFieldError('messageTooLong');
    setFieldError(null);
    // All of them chosen: send none, which the API reads as "all that you hold".
    const ticketIds = chosen.size === order.ticketIds.length ? [] : [...chosen];
    request.mutate(
      { ticketIds, message: message.trim() },
      {
        onSuccess: () => setSent(true),
        onError: (error) => {
          const p = viewProblem(error);
          setFailureKey({ key: refundErrorKey(p), seconds: p.retryAfter ?? 0 });
        },
      },
    );
  };

  const cachedTicket = (id: string) => queryClient.getQueryData<Ticket>(ticketKeys.detail(id));

  const latest = panel.latest;
  return (
    <View style={styles.stack} testID="refund-panel">
      {policyText ? (
        <Card testID="refund-policy">
          <Heading level={2}>{t('refund.policy')}</Heading>
          <Body>{policyText}</Body>
          {policy && policy.retainedMinor > 0 ? (
            <Body tone="ink2">
              {t('refund.policyRetained', {
                amount: formatMoney(format, policy.retainedMinor, policy.currency),
              })}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {latest ? (
        <Card testID="refund-latest">
          <Heading level={2}>{t('refund.latest')}</Heading>
          <Body>
            {latest.status === 'open'
              ? t('refund.statusOpen')
              : latest.status === 'approved'
                ? t('refund.statusApproved', {
                    when: formatMoment(format, latest.decidedAt ?? latest.createdAt, zone),
                  })
                : t('refund.statusDeclined', {
                    when: formatMoment(format, latest.decidedAt ?? latest.createdAt, zone),
                  })}
          </Body>
          <Caption>{t('refund.requestTickets', { count: latest.tickets })}</Caption>
          {latest.status === 'declined' && latest.declineReason ? (
            <Body tone="ink2">{t('refund.declineReason', { reason: latest.declineReason })}</Body>
          ) : null}
        </Card>
      ) : null}

      {sent ? (
        <Banner tone="success" testID="refund-sent">
          {t('refund.sent')}
        </Banner>
      ) : panel.canRequest ? (
        <Card testID="refund-form">
          {failureKey ? (
            <Banner tone="danger" testID="refund-error">
              {t(failureKey.key, { seconds: failureKey.seconds })}
            </Banner>
          ) : null}
          <Text accessibilityRole="header" style={[styles.legend, { color: colors.ink }]}>
            {t('refund.ticketsLegend')}
          </Text>
          {order.ticketIds.map((id, index) => {
            const label = cachedTicket(id)
              ? `${t('refund.ticketOption', { n: index + 1 })} · ${cachedTicket(id)?.ticketTypeName ?? ''}`
              : t('refund.ticketOption', { n: index + 1 });
            const on = chosen.has(id);
            return (
              <View key={id} style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: colors.ink }]}>{label}</Text>
                <Switch
                  value={on}
                  accessibilityLabel={label}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on }}
                  trackColor={{ true: colors.primary, false: colors.lineStrong }}
                  testID={`refund-ticket-${index}`}
                  onValueChange={(value) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (value) next.add(id);
                      else next.delete(id);
                      return next;
                    })
                  }
                />
              </View>
            );
          })}
          {fieldError === 'pickOne' ? (
            <Text style={{ color: colors.danger }} accessibilityLiveRegion="polite" testID="pick-one-error">
              {t('refund.pickOne')}
            </Text>
          ) : null}
          <Field
            label={t('refund.message')}
            value={message}
            onChangeText={setMessage}
            error={fieldError === 'messageTooLong' ? t('refund.messageTooLong') : null}
            multiline
            numberOfLines={3}
            autoComplete="off"
            maxLength={1100}
            testID="refund-message"
          />
          <Button
            label={t('refund.submit')}
            busy={request.isPending}
            onPress={submit}
            testID="refund-submit"
          />
        </Card>
      ) : panel.refusal ? (
        <Banner tone="info" testID="refund-refusal">
          {t(`refund.refusal.${panel.refusal}`)}
        </Banner>
      ) : null}
    </View>
  );
}

export function RefundScreen({ id }: { id: string }) {
  const t = useTranslations('tickets');
  const router = useRouter();
  const ticket = useTicket(id);
  const order = useOrder(ticket.data?.orderId);
  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.ticket(id)));
  const waiting =
    (ticket.isPending || (ticket.data && order.isPending)) &&
    ticket.fetchStatus !== 'paused' &&
    order.fetchStatus !== 'paused';
  return (
    <Screen testID="refund-screen">
      <BackBar label={t('common.back')} onBack={back} />
      <Heading>{t('refund.title')}</Heading>
      {order.data ? (
        <RefundPanel order={order.data} />
      ) : waiting ? (
        <Loading label={t('refund.loading')} />
      ) : (
        <EmptyState
          testID="refund-error"
          title={t('refund.loadFailed')}
          body={
            ticket.fetchStatus === 'paused' || order.fetchStatus === 'paused'
              ? t('common.offline')
              : undefined
          }
          action={
            <Button
              label={t('common.retry')}
              onPress={() => {
                void ticket.refetch();
                void order.refetch();
              }}
              testID="retry"
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  legend: { fontSize: 15, fontWeight: '800', textAlign: 'auto' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: space[3],
  },
  switchLabel: { flex: 1, fontSize: 15, textAlign: 'auto' },
});
