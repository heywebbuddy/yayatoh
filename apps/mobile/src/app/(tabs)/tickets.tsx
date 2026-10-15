import { useTranslations } from 'use-intl';
import { Heading, Screen } from '../../auth/ui';

/** Placeholder until M7.3b's Tickets tab is merged (the merge keeps theirs). */
export default function TicketsTab() {
  const t = useTranslations('account.tabs');
  return (
    <Screen edges={['top', 'left', 'right']} testID="tickets-screen">
      <Heading>{t('tickets')}</Heading>
    </Screen>
  );
}
