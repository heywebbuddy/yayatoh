import { isSocialProvider, pendingLinkProof } from '@yayatoh/auth';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LinkProofForm } from '@/components/link-proof-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';
import { requestHost } from '@/server/request-origin.ts';
import { safeNext } from '@/server/sign-in-finish.ts';
import { linkProofCookie } from '@/server/social.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'socialLink' });
  return { title: t('metaTitle') };
}

/**
 * "Is this your account?" (M1.2f): a Google/Apple sign-in whose email already has an account. We
 * sent a code to that address; typing it proves the address and links the provider. The address
 * is shown as the account knows it; nothing is linked until the code is right.
 */
export default async function LinkProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ provider?: string; next?: string; return?: string; state?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('socialLink');
  const here = await requestHost();
  const id = (await cookies()).get(linkProofCookie(here.protocol === 'https:'))?.value ?? '';
  const pending = here.kind === 'tenant' ? null : await pendingLinkProof(getAuth(), id);
  const provider = pending?.provider ?? (isSocialProvider(sp.provider) ? sp.provider : 'google');
  const providerName = t(`provider.${provider}`);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title', { provider: providerName })}
        description={pending ? t('description', { provider: providerName, email: pending.email }) : undefined}
      />
      <Card size="panel">
        {pending ? (
          <LinkProofForm
            target={{ next: safeNext(sp.next), returnUrl: sp.return ?? null, state: sp.state ?? null }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-body text-zinc-600">{t('expired')}</p>
            <Link href="/sign-in" className="self-start text-body underline underline-offset-4">
              {t('startOver')}
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
