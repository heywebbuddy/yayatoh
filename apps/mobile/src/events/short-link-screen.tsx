/** `/e/[code]` (M7.3c): finds the event a short code names and opens it. */

import { useQuery } from '@tanstack/react-query';
import { ROUTES, space, useColors } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { useWebBaseUrl } from '../shop/api';
import { useShopPorts } from '../shop/ports';
import { Banner, Button, Empty, Loading } from '../shop/ui';

export function ShortLinkScreen({ code }: { code: string }) {
  const t = useTranslations('discover.shortLink');
  const common = useTranslations('core.common');
  const router = useRouter();
  const colors = useColors();
  const ports = useShopPorts();
  const base = useWebBaseUrl();

  const slug = useQuery({
    queryKey: ['shop', 'short-link', code],
    enabled: base.data !== undefined,
    retry: false,
    queryFn: () => ports.links.resolveShortCode(base.data ?? '', code),
  });

  useEffect(() => {
    if (slug.data) router.replace({ pathname: ROUTES.event, params: { slug: slug.data } });
  }, [slug.data, router]);

  const failed = base.isError || slug.isError;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {slug.data === null ? (
        <Empty
          testID="short-link-not-found"
          title={t('notFoundTitle')}
          body={t('notFoundBody')}
          action={<Button label={t('browse')} onPress={() => router.replace('/discover')} />}
        />
      ) : failed ? (
        <Banner
          tone="danger"
          title={t('errorTitle')}
          testID="short-link-error"
          action={
            <Button
              label={common('retry')}
              onPress={() => void (base.isError ? base.refetch() : slug.refetch())}
            />
          }
        >
          {common('errors.network')}
        </Banner>
      ) : (
        <Loading label={t('opening')} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, padding: space[4], justifyContent: 'center' } });
