/**
 * `/orders/link/[token]` (M7.3c): the link in an order email. The order it names belongs to whoever
 * holds the link, not to a signed-in account, and `/v1` has no route for that, so the app opens the web
 * order page in the secure browser. (The person's own orders are in Account → Orders.)
 */
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';
import { useWebBaseUrl } from '../shop/api';
import { useShopPorts } from '../shop/ports';
import { Banner, Button, Heading, Page } from '../shop/ui';

export function OrderLinkScreen({ token }: { token: string }) {
  const t = useTranslations('orders.link');
  const router = useRouter();
  const ports = useShopPorts();
  const base = useWebBaseUrl();
  const url = base.data ? `${base.data.replace(/\/+$/, '')}/orders/${encodeURIComponent(token)}` : null;
  return (
    <Page>
      <Heading>{t('title')}</Heading>
      <Banner tone="info" title={t('bannerTitle')} testID="order-link-banner">
        {t('body')}
      </Banner>
      <Button
        label={t('open')}
        onPress={() => url && void ports.browser.openWeb(url)}
        disabled={!url}
        testID="order-link-open"
      />
      <Button
        tone="secondary"
        label={t('myOrders')}
        onPress={() => router.replace('/orders')}
        testID="order-link-orders"
      />
    </Page>
  );
}
