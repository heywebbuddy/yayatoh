import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, PageHeader } from '@yayatoh/ui';
import { webhookPortalQuery } from '@yayatoh/webhooks';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { webhooksAvailable } from '../shared.ts';

/**
 * The webhook provider's customer portal, embedded (M6.3b; Svix's App Portal, the fake in dev and
 * CI): endpoints, delivery logs, replay and event-type browsing in one place. A short-lived link,
 * made per page view. Everything it does is also on the console's own Webhooks pages, which are
 * the keyboard and screen-reader path we test.
 */
export default async function WebhookPortalPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'webhooks:manage') || !data.modules.has('api_access') || !webhooksAvailable())
    notFound();
  const t = await getTranslations('webhooks');
  let portal: { url: string } | null = null;
  try {
    portal = await executeQuery(webhookPortalQuery, {}, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
  }
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/webhooks`} className="text-caption underline underline-offset-2">
            {t('back')}
          </Link>
        }
        title={t('portalTitle')}
        description={t('portalSubtitle')}
      />
      <p className="text-body text-ink-2">
        {t.rich('portalAlternative', {
          link: (chunks) => (
            <Link href={`/o/${org}/webhooks`} className="underline underline-offset-2">
              {chunks}
            </Link>
          ),
        })}
      </p>
      {portal ? (
        <iframe
          src={portal.url}
          title={t('portalFrameTitle')}
          className="h-[720px] w-full rounded-card border border-line bg-white"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Alert title={t('portalUnavailable')} />
      )}
    </>
  );
}
