/**
 * A web "My tickets" link opened in the app (M7.3b): sign in, then open the ticket it names. One
 * ticket opens straight away; several for the same event are listed to choose from.
 */
import { useCore, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { isNotFound } from '../api';
import { useTicket, useTicketLink } from '../hooks';
import { hrefs } from '../nav';
import { rememberPending } from '../pending';
import { Body, Button, Card, EmptyState, Heading, Loading, Screen } from '../ui';

function TicketChoice({ id }: { id: string }) {
  const router = useRouter();
  const { data } = useTicket(id);
  if (!data) return null;
  return (
    <Button
      label={`${data.ticketTypeName} · ${data.holderName}`}
      variant="secondary"
      onPress={() => router.replace(hrefs.ticket(id))}
      testID={`choose-${id}`}
    />
  );
}

export function TicketLinkScreen({ token }: { token: string }) {
  const t = useTranslations('tickets');
  const router = useRouter();
  const core = useCore();
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const link = useTicketLink(token, signedIn);
  const ids = link.data?.ticketIds;

  useEffect(() => {
    if (ids && ids.length === 1) router.replace(hrefs.ticket(ids[0] as string));
  }, [ids, router]);

  if (session.status === 'loading') {
    return (
      <Screen testID="link-screen">
        <Loading label={t('link.loading')} />
      </Screen>
    );
  }
  if (session.status === 'signedOut') {
    return (
      <Screen testID="link-screen">
        <Heading>{t('link.title')}</Heading>
        <Card testID="link-sign-in">
          <Heading level={2}>{t('link.signInTitle')}</Heading>
          <Body tone="ink2">{t('link.signInBody')}</Body>
          <Button
            label={t('link.signIn')}
            testID="sign-in"
            onPress={() => {
              void rememberPending(core.storage, { kind: 'link', token }).then(() =>
                router.push(hrefs.signIn()),
              );
            }}
          />
        </Card>
      </Screen>
    );
  }
  if (link.isPending && link.fetchStatus !== 'paused') {
    return (
      <Screen testID="link-screen">
        <Loading label={t('link.loading')} />
      </Screen>
    );
  }
  if (!ids || ids.length === 0) {
    return (
      <Screen testID="link-screen">
        <EmptyState
          testID="link-not-found"
          title={t('link.notFoundTitle')}
          body={t('link.notFoundBody')}
          action={
            <>
              {link.isError && !isNotFound(link.error) ? (
                <Button label={t('link.retry')} onPress={() => void link.refetch()} testID="retry" />
              ) : null}
              <Button
                label={t('link.toMyTickets')}
                variant="secondary"
                onPress={() => router.replace(hrefs.tickets())}
                testID="to-tickets"
              />
            </>
          }
        />
      </Screen>
    );
  }
  return (
    <Screen testID="link-screen">
      <Heading>{t('link.title')}</Heading>
      {ids.length === 1 ? (
        <Loading label={t('link.loading')} />
      ) : (
        ids.map((id) => <TicketChoice key={id} id={id} />)
      )}
    </Screen>
  );
}
