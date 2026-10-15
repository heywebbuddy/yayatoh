/**
 * Claim a ticket from a link (M7.3b): what is being claimed, sign-in if there is no session, then the
 * claim. A transfer can only be claimed with the address it was sent to; when the signed-in address
 * is a different one the screen says so and offers to switch accounts.
 */
import { useCore, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { isNotFound, type ProblemView, viewProblem } from '../api';
import { formatEventRange } from '../format';
import { useClaimDetails, useClaimTicket } from '../hooks';
import { hrefs } from '../nav';
import { rememberPending } from '../pending';
import {
  BackBar,
  Banner,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Fact,
  Field,
  Heading,
  Loading,
  Screen,
} from '../ui';

export type ClaimFailure =
  | { kind: 'mismatch' }
  | { kind: 'state'; state: 'claimed' | 'revoked' | 'expired' }
  | { kind: 'message'; key: string; seconds?: number };

/** What a failed claim means to the person, from the server's stable codes. */
export function claimFailure(p: ProblemView): ClaimFailure {
  if (p.code === 'validation_failed' && p.reason === 'email_mismatch') return { kind: 'mismatch' };
  const state = p.details.state;
  if (p.code === 'invalid_state' && (state === 'claimed' || state === 'revoked' || state === 'expired'))
    return { kind: 'state', state };
  if (p.network) return { kind: 'message', key: 'common.network' };
  if (p.status === 429)
    return p.retryAfter
      ? { kind: 'message', key: 'common.rateLimited', seconds: p.retryAfter }
      : { kind: 'message', key: 'common.rateLimitedNoTime' };
  if (p.status === 403 && p.reason === 'email_unverified')
    return { kind: 'message', key: 'claim.unverified' };
  if (p.status === 404) return { kind: 'message', key: 'claim.invalid' };
  return { kind: 'message', key: 'claim.failed' };
}

export function ClaimScreen({ token }: { token: string }) {
  const t = useTranslations('tickets');
  const router = useRouter();
  const core = useCore();
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const details = useClaimDetails(token, signedIn);
  const claim = useClaimTicket(token);
  const format = useFormatter();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [failure, setFailure] = useState<ClaimFailure | null>(null);

  // The name on the ticket starts as the account's name.
  const accountName = session.status === 'signedIn' ? session.user.name : '';
  useEffect(() => {
    setName((current) => current || accountName || '');
  }, [accountName]);

  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.tickets()));
  const signIn = async () => {
    await rememberPending(core.storage, { kind: 'claim', token });
    router.push(hrefs.signIn());
  };
  const switchAccount = async () => {
    await rememberPending(core.storage, { kind: 'claim', token });
    await core.session.signOut();
  };

  if (session.status === 'loading') {
    return (
      <Screen testID="claim-screen">
        <Loading label={t('claim.loading')} />
      </Screen>
    );
  }
  if (session.status === 'signedOut') {
    return (
      <Screen testID="claim-screen">
        <Heading>{t('claim.title')}</Heading>
        <Card testID="claim-sign-in">
          <Heading level={2}>{t('claim.signInTitle')}</Heading>
          <Body tone="ink2">{t('claim.signInBody')}</Body>
          <Button label={t('claim.signIn')} onPress={() => void signIn()} testID="sign-in" />
        </Card>
      </Screen>
    );
  }

  const submit = () => {
    setFailure(null);
    if (name.trim().length === 0) return setNameError(true);
    setNameError(false);
    claim.mutate({ name: name.trim() }, { onError: (error) => setFailure(claimFailure(viewProblem(error))) });
  };

  if (claim.data) {
    const ticket = claim.data;
    return (
      <Screen testID="claim-screen">
        <Card testID="claim-success">
          <Heading>{t('claim.success')}</Heading>
          <Body>{t('claim.successBody', { type: ticket.ticketTypeName, event: ticket.event.name })}</Body>
          <Button
            label={t('claim.view')}
            onPress={() => router.replace(hrefs.ticket(ticket.id))}
            testID="view-ticket"
          />
        </Card>
      </Screen>
    );
  }

  const d = details.data;
  const stateFailure: ClaimFailure | null =
    d && d.state !== 'open' ? { kind: 'state', state: d.state } : failure?.kind === 'state' ? failure : null;

  return (
    <Screen testID="claim-screen">
      <BackBar label={t('common.back')} onBack={back} />
      <Heading>{t('claim.title')}</Heading>
      {details.isPending && details.fetchStatus !== 'paused' ? (
        <Loading label={t('claim.loading')} />
      ) : !d ? (
        <EmptyState
          testID="claim-invalid"
          title={isNotFound(details.error) ? t('claim.invalid') : t('claim.failed')}
          body={isNotFound(details.error) ? t('claim.invalidBody') : undefined}
          action={
            isNotFound(details.error) ? undefined : (
              <Button label={t('common.retry')} onPress={() => void details.refetch()} testID="retry" />
            )
          }
        />
      ) : stateFailure?.kind === 'state' ? (
        <EmptyState
          testID={`claim-${stateFailure.state}`}
          title={t(`claim.state${cap(stateFailure.state)}`)}
          body={t(`claim.state${cap(stateFailure.state)}Body`)}
          action={
            <Button
              label={t('common.toMyTickets')}
              variant="secondary"
              onPress={() => router.replace(hrefs.tickets())}
            />
          }
        />
      ) : (
        <>
          <Card testID="claim-offer">
            <Body>
              {d.transfer
                ? t('claim.offerFrom', { from: d.transfer.fromName, event: d.event.name })
                : t('claim.offerPlain', { organizer: d.organizerName, event: d.event.name })}
            </Body>
            {d.transfer ? <Caption>{t('claim.forYou', { name: d.transfer.toName })}</Caption> : null}
            <Fact label={t('claim.ticketType')} value={d.ticketTypeName} />
            <Fact
              label={t('claim.when')}
              value={formatEventRange(
                format,
                d.event.startsAt,
                d.event.endsAt,
                d.event.timezone,
                t('common.rangeSeparator'),
              )}
            />
            <Fact label={t('claim.organizer')} value={d.organizerName} />
          </Card>
          <Caption testID="signed-in-as">
            {t('claim.signedInAs', { email: session.status === 'signedIn' ? session.user.email : '' })}
          </Caption>
          {failure?.kind === 'mismatch' ? (
            <Card testID="claim-mismatch">
              <Banner tone="warning" title={t('claim.mismatchTitle')}>
                {d.transfer
                  ? t('claim.mismatchBody', {
                      name: d.transfer.toName,
                      email: session.status === 'signedIn' ? session.user.email : '',
                    })
                  : t('claim.mismatchBodyPlain', {
                      email: session.status === 'signedIn' ? session.user.email : '',
                    })}
              </Banner>
              <Button
                label={t('claim.switchAccount')}
                variant="secondary"
                onPress={() => void switchAccount()}
                testID="switch-account"
              />
            </Card>
          ) : failure?.kind === 'message' ? (
            <Banner tone="danger" testID="claim-error">
              {t(failure.key, { seconds: failure.seconds ?? 0 })}
            </Banner>
          ) : null}
          <Field
            label={t('claim.name')}
            value={name}
            onChangeText={setName}
            error={nameError ? t('claim.nameRequired') : null}
            autoComplete="name"
            textContentType="name"
            testID="claim-name"
          />
          <Button
            label={claim.isPending ? t('claim.claiming') : t('claim.submit')}
            busy={claim.isPending}
            onPress={submit}
            testID="claim-submit"
          />
        </>
      )}
    </Screen>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
