/**
 * Transfer a ticket (M7.3b): the recipient's name and email, a confirmation, then the API. The
 * ticket stays the sender's until the recipient claims it. A ticket type with a transfer fee is
 * agreed and paid on the web, in the system's secure browser session.
 */
import { space, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import { type Ticket, type TransferResult, type ProblemView, viewProblem } from '../api';
import { formatMoney, formatMoment } from '../format';
import { useRefreshTickets, useStartTransfer, useTicket } from '../hooks';
import { hrefs } from '../nav';
import { useTicketServices } from '../services';
import { BackBar, Banner, Body, Button, Card, EmptyState, Field, Heading, Loading, Screen } from '../ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TransferFormErrors {
  readonly name?: 'nameRequired' | 'nameTooLong';
  readonly email?: 'emailInvalid' | 'emailIsYours';
}

/** The form's own checks, the same limits the API enforces (name 1–120, a valid email). */
export function validateTransfer(name: string, email: string, ownEmail: string | null): TransferFormErrors {
  const trimmed = name.trim();
  const address = email.trim();
  return {
    ...(trimmed.length === 0 ? { name: 'nameRequired' as const } : trimmed.length > 120 ? { name: 'nameTooLong' as const } : {}),
    ...(!EMAIL.test(address) || address.length > 254
      ? { email: 'emailInvalid' as const }
      : ownEmail && address.toLowerCase() === ownEmail.toLowerCase()
        ? { email: 'emailIsYours' as const }
        : {}),
  };
}

/** The message key (under `tickets`) for a failed transfer call. */
export function transferErrorKey(p: ProblemView): string {
  if (p.network) return 'common.network';
  if (p.status === 429) return p.retryAfter ? 'common.rateLimited' : 'common.rateLimitedNoTime';
  if (p.status === 403 && p.reason === 'email_unverified') return 'common.verifyEmail';
  if (p.status === 404) return 'common.notFoundTitle';
  if (p.code === 'validation_failed' && p.reason === 'same_holder') return 'transfer.sameHolder';
  if (p.code === 'invalid_state' && typeof p.reason === 'string' && p.reason in REFUSALS)
    return `detail.transferRefused.${p.reason}`;
  if (p.code === 'invalid_state') return 'transfer.invalidState';
  return 'common.unexpected';
}
const REFUSALS = { ticket_void: 1, event_ended: 1, not_allowed: 1, deadline_passed: 1 } as const;

export function TransferScreen({ id }: { id: string }) {
  const t = useTranslations('tickets');
  const router = useRouter();
  const query = useTicket(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.ticket(id)));
  const ticket = query.data;
  if (!ticket) {
    return (
      <Screen testID="transfer-screen">
        <BackBar label={t('common.back')} onBack={back} />
        {query.isPending && query.fetchStatus !== 'paused' ? (
          <Loading label={t('detail.loading')} />
        ) : (
          <EmptyState
            title={t('detail.loadFailed')}
            action={<Button label={t('common.retry')} onPress={() => void query.refetch()} />}
          />
        )}
      </Screen>
    );
  }
  return <TransferForm ticket={ticket} onBack={back} />;
}

function TransferForm({ ticket, onBack }: { ticket: Ticket; onBack: () => void }) {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const session = useSession();
  const services = useTicketServices();
  const refresh = useRefreshTickets();
  const start = useStartTransfer(ticket.id);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'sent' | 'web'>('form');
  const [errors, setErrors] = useState<TransferFormErrors>({});
  const [failure, setFailure] = useState<{ key: string; seconds: number } | null>(null);

  const ownEmail = session.status === 'signedIn' ? session.user.email : null;
  const t0 = ticket.transfer;
  const fee = t0.feeMinor > 0 ? formatMoney(format, t0.feeMinor, t0.currency) : null;
  const closed = !t0.allowed;

  const review = () => {
    const found = validateTransfer(name, email, ownEmail);
    setErrors(found);
    setFailure(null);
    if (!found.name && !found.email) setStep('confirm');
  };

  const send = () => {
    setFailure(null);
    start.mutate(
      { toName: name.trim(), toEmail: email.trim() },
      {
        onSuccess: (result: TransferResult) => {
          if (result.status === 'web_payment_required' && result.webUrl) {
            setStep('web');
            void services.openWeb(result.webUrl).finally(() => void refresh());
          } else {
            setStep('sent');
          }
        },
        onError: (error) => {
          const problem = viewProblem(error);
          setFailure({ key: transferErrorKey(problem), seconds: problem.retryAfter ?? 0 });
          setStep('form');
        },
      },
    );
  };

  const failureText = failure
    ? t(failure.key, {
        seconds: failure.seconds,
        deadline: formatMoment(format, t0.deadline, ticket.event.timezone),
      })
    : null;

  return (
    <Screen testID="transfer-screen">
      <BackBar label={t('common.back')} onBack={onBack} />
      <Heading>{t('transfer.title')}</Heading>
      {failureText ? (
        <Banner tone="danger" testID="transfer-error">
          {failureText}
        </Banner>
      ) : null}

      {step === 'sent' ? (
        <Card testID="transfer-sent">
          <Heading level={2}>{t('transfer.sentTitle')}</Heading>
          <Body>{t('transfer.sentBody', { name: name.trim(), email: email.trim() })}</Body>
          <Button label={t('transfer.done')} onPress={onBack} testID="done" />
        </Card>
      ) : step === 'web' ? (
        <Card testID="transfer-web">
          <Body>{t('transfer.webOpened')}</Body>
          <Button label={t('transfer.done')} onPress={onBack} testID="done" />
        </Card>
      ) : closed ? (
        <Banner tone="warning" testID="transfer-closed">
          {ticket.transfer.reason === 'deadline_passed'
            ? t('transfer.closed', { deadline: formatMoment(format, t0.deadline, ticket.event.timezone) })
            : t(`detail.transferRefused.${ticket.transfer.reason ?? 'not_allowed'}`, {
                deadline: formatMoment(format, t0.deadline, ticket.event.timezone),
              })}
        </Banner>
      ) : step === 'confirm' ? (
        <Card testID="transfer-confirm">
          <Heading level={2}>{t('transfer.confirmTitle')}</Heading>
          <Body>
            {t('transfer.confirmBody', {
              ticket: `${ticket.ticketTypeName} · ${ticket.event.name}`,
              name: name.trim(),
              email: email.trim(),
            })}
          </Body>
          {fee ? (
            <Banner tone="warning" testID="fee-notice">
              {t('transfer.feeNotice', { fee })}
            </Banner>
          ) : null}
          <View style={styles.row}>
            <Button
              label={fee ? t('transfer.continueWeb') : t('transfer.send')}
              busy={start.isPending}
              onPress={send}
              testID="send"
            />
            <Button label={t('transfer.edit')} variant="secondary" onPress={() => setStep('form')} testID="edit" />
          </View>
        </Card>
      ) : (
        <Card testID="transfer-form">
          <Body tone="ink2">{t('transfer.intro')}</Body>
          <Field
            label={t('transfer.toName')}
            value={name}
            onChangeText={setName}
            error={errors.name ? t(`transfer.${errors.name}`) : null}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            returnKeyType="next"
            testID="to-name"
          />
          <Field
            label={t('transfer.toEmail')}
            value={email}
            onChangeText={setEmail}
            error={errors.email ? t(`transfer.${errors.email}`) : null}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="done"
            onSubmitEditing={review}
            testID="to-email"
          />
          <Button label={t('transfer.review')} onPress={review} testID="review" />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { gap: space[2] } });
