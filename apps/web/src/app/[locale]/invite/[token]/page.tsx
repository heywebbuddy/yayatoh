import { lookupInvitation } from '@yayatoh/tenancy';
import { Alert, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';
import { acceptInviteAction } from './actions.ts';

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const h = await headers();
  const inv = await lookupInvitation(decodeURIComponent(token));
  const session = await getAuth().api.getSession({ headers: h });
  const next = `/invite/${token}`;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('invite.eyebrow')}</Label>}
        title={inv ? t('invite.title', { org: inv.orgName }) : t('invite.invalidTitle')}
      />
      <Card size="panel" className="flex flex-col gap-4">
        {!inv || inv.status !== 'pending' ? (
          <Alert title={t(`invite.status.${inv?.status ?? 'invalid'}`)} />
        ) : !session ? (
          <>
            <p className="text-body text-zinc-600">{t('invite.signInFirst', { email: inv.email })}</p>
            <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className={buttonClass('primary')}>
              {t('invite.signIn')}
            </Link>
          </>
        ) : session.user.email.toLowerCase() !== inv.email ? (
          <Alert title={t('invite.wrongAccount', { email: inv.email })} />
        ) : (
          <form
            action={acceptInviteAction.bind(null, decodeURIComponent(token))}
            className="flex flex-col gap-3"
          >
            <p className="text-body text-zinc-600">{t('invite.join', { role: t(`roles.${inv.role}`) })}</p>
            <button type="submit" className={buttonClass('primary')}>
              {t('invite.accept')}
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
