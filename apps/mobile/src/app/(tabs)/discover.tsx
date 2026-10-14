import { useTranslations } from 'use-intl';
import { Heading, Screen } from '../../auth/ui';

/** Placeholder until M7.3c's Discover tab is merged (the merge keeps theirs). */
export default function DiscoverTab() {
  const t = useTranslations('account.tabs');
  return (
    <Screen testID="discover-screen">
      <Heading>{t('discover')}</Heading>
    </Screen>
  );
}
