import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { WelcomePoll } from '@/components/signup/welcome-poll.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { myOrgBySlug } from '@/server/self-serve.ts';
import { ownAuthSession } from '@/server/session.ts';

/**
 * Back from the provider's checkout. The redirect proves nothing: the plan is switched on by the
 * provider's webhook, so this page waits for it (a few seconds) and then opens the organization.
 */
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ org?: string; plan?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const session = await ownAuthSession();
  if (!session) return redirect({ href: '/signup', locale });
  const org = await myOrgBySlug(session.user.id, sp.org ?? '');
  if (!org) return redirect({ href: '/signup', locale });
  const t = await getTranslations('selfServe.welcome');
  return (
    <ShowcaseShell>
      <section
        aria-labelledby="welcome-h"
        className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[36px] border border-line bg-surface p-8 md:p-12"
      >
        <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{t('eyebrow')}</p>
        <h1
          id="welcome-h"
          className="m-0 font-display text-[clamp(1.8rem,4vw,3rem)] leading-tight font-black text-ink uppercase"
        >
          {t('title', { org: org.name })}
        </h1>
        <WelcomePoll
          slug={org.slug}
          plan={sp.plan ?? ''}
          labels={{ waiting: t('waiting'), done: t('done'), slow: t('slow'), open: t('open') }}
        />
      </section>
    </ShowcaseShell>
  );
}
