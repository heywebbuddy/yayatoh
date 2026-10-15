/** `/e/[code]` (M7.3c): finds the event a short code names and opens it. */

import { useQuery } from '@tanstack/react-query';
import { ROUTES } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useWebBaseUrl } from '../shop/api';
import { useShopPorts } from '../shop/ports';
import { Banner, Button, Empty, Loading, Page } from '../shop/ui';

export function ShortLinkScreen({ code }: { code: string }) {
  const t = useTranslations('discover.shortLink');
  const core = useTranslations('core');
  const router = useRouter();
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
    <Page>
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
          heading
          testID="short-link-error"
          action={
            <Button
              label={core('common.retry')}
              onPress={() => void (base.isError ? base.refetch() : slug.refetch())}
            />
          }
        >
          {core('errors.network')}
        </Banner>
      ) : (
        <Loading label={t('opening')} />
      )}
    </Page>
  );
}
