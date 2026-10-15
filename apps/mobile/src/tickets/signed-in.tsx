import { useSession } from '@yayatoh/mobile-core';
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { hrefs } from './nav';
import { Loading, Screen } from './ui';

/**
 * Tickets belong to a signed-in person. A screen opened without a session (a link, a notification, a
 * session that just ended) goes to the welcome flow instead of showing a load error.
 */
export function SignedInOnly({ children }: { children: ReactNode }) {
  const t = useTranslations('tickets');
  const session = useSession();
  if (session.status === 'loading')
    return (
      <Screen testID="session-loading">
        <Loading label={t('common.loading')} />
      </Screen>
    );
  if (session.status === 'signedOut') return <Redirect href={hrefs.signIn()} />;
  return children;
}
