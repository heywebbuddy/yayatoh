import { consumeGuestLink } from '@yayatoh/orders';
import { Button, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { linkCodeAction, openLinkAction } from '@/app/[locale]/my-tickets/actions.ts';
import { LinkCodeForm } from '@/components/my-tickets-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { browserState } from '@/server/guest.ts';

/**
 * A sign-in magic link (M1.5f). Nothing is spent by opening the page (mail scanners fetch links):
 * in the browser that asked for it, Continue signs in; anywhere else the page asks for the code
 * from the same email, so a forwarded link alone opens nothing.
 */
export async function MyTicketsVerifyView({
  orgId,
  siteName,
  token,
}: {
  orgId: string | null;
  siteName: string;
  token: string;
}) {
  const t = await getTranslations();
  const r = await consumeGuestLink({
    token,
    browserState: await browserState(false),
    scopeOrgId: orgId,
    spend: false,
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader eyebrow={<Label>{siteName}</Label>} title={t('attendeeSignIn.title')} />
      {r.status === 'invalid' ? (
        <EmptyState
          title={t('attendeeSignIn.linkInvalidTitle')}
          description={t('attendeeSignIn.linkInvalidDescription')}
          action={
            <Link href="/my-tickets" className="text-body underline underline-offset-2">
              {t('attendeeSignIn.startAgain')}
            </Link>
          }
        />
      ) : r.status === 'ok' ? (
        <Card className="flex flex-col gap-4">
          <p className="text-body">{t('attendeeSignIn.linkReady', { email: r.email })}</p>
          <form action={openLinkAction.bind(null, orgId, token)}>
            <Button type="submit">{t('attendeeSignIn.continue')}</Button>
          </form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="text-body">{t('attendeeSignIn.otherBrowser')}</p>
          <LinkCodeForm action={linkCodeAction.bind(null, orgId, token)} />
        </Card>
      )}
    </main>
  );
}
