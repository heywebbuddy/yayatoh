import { selfServePrice } from '@yayatoh/billing';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { PayRetry } from '@/components/signup/pay-retry.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { myOrgBySlug } from '@/server/self-serve.ts';
import { ownAuthSession } from '@/server/session.ts';
import { continueWithoutPaymentAction, resumePaymentAction } from '../self-serve-actions.ts';

/**
 * Where a failed or cancelled payment lands: the organization exists on its start plan; nothing
 * was charged. The person can try the payment again or open the organization for now.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    org?: string;
    plan?: string;
    interval?: string;
    cancelled?: string;
    failed?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const session = await ownAuthSession();
  if (!session) return redirect({ href: '/signup', locale });
  const org = await myOrgBySlug(session.user.id, sp.org ?? '');
  if (!org) return redirect({ href: '/signup', locale });
  const t = await getTranslations('selfServe.pay');
  const interval = sp.interval === 'year' ? 'year' : 'month';
  const price = await selfServePrice(sp.plan ?? '', interval);
  return (
    <ShowcaseShell>
      <section
        aria-labelledby="pay-h"
        className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[36px] border border-line bg-surface p-8 md:p-12"
      >
        <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{t('eyebrow')}</p>
        <h1
          id="pay-h"
          className="m-0 font-display text-[clamp(1.8rem,4vw,3rem)] leading-tight font-black text-ink uppercase"
        >
          {t(sp.failed ? 'failedTitle' : 'cancelledTitle')}
        </h1>
        <p className="m-0 text-[17px] leading-relaxed text-ink-2" role="status">
          {t(sp.failed ? 'failedBody' : 'cancelledBody', { org: org.name, plan: price?.planName ?? '' })}
        </p>
        <PayRetry
          retry={resumePaymentAction}
          skip={continueWithoutPaymentAction}
          org={org.slug}
          plan={sp.plan ?? ''}
          interval={interval}
          available={Boolean(price && !price.free)}
        />
      </section>
    </ShowcaseShell>
  );
}
