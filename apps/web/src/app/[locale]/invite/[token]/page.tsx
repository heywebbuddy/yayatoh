import { invitationEvent } from '@yayatoh/events';
import { lookupInvitation } from '@yayatoh/tenancy';
import { Alert, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthBar } from '@/components/auth-bar.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ownAuthSession } from '@/server/session.ts';
import { acceptInviteAction } from './actions.ts';

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const inv = await lookupInvitation(decodeURIComponent(token));
  // M4.2a: an event invitation names the event and the event role (co-host, planner).
  const ev = inv ? await invitationEvent(inv.invitationId) : null;
  const session = await ownAuthSession();
  const next = `/invite/${token}`;
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md flex-col justify-center gap-6 px-6 py-16"
      >
        <PageHeader
          eyebrow={<Label>{t('invite.eyebrow')}</Label>}
          title={
            inv
              ? ev
                ? t('invite.eventTitle', { event: ev.eventName })
                : t('invite.title', { org: inv.orgName })
              : t('invite.invalidTitle')
          }
        />
        <Card size="panel" className="flex flex-col gap-4">
          {inv?.status !== 'pending' ? (
            <Alert title={t(`invite.status.${inv?.status ?? 'invalid'}`)} />
          ) : !session ? (
            <>
              <p className="text-body text-ink-2">{t('invite.signInFirst', { email: inv.email })}</p>
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
              <p className="text-body text-ink-2">
                {ev
                  ? t('invite.joinEvent', {
                      role: t(`eventRoles.${ev.eventRole}`),
                      event: ev.eventName,
                      org: inv.orgName,
                    })
                  : t('invite.join', { role: t(`roles.${inv.role}`) })}
              </p>
              <button type="submit" className={buttonClass('primary')}>
                {t('invite.accept')}
              </button>
            </form>
          )}
        </Card>
      </main>
    </>
  );
}
