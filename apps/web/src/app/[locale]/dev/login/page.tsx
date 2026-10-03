import { Avatar, buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { adminSignInUrl, initialsOf, PERSONAS } from '@/server/personas.ts';
import { devAuthEnabled } from '@/server/session.ts';

export default async function DevLogin({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!devAuthEnabled()) notFound();
  const t = await getTranslations();
  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('devLogin.eyebrow')}</Label>}
        title={t('devLogin.title')}
        description={t('devLogin.description')}
      />
      <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {PERSONAS.map((p) => (
          <li key={p.email}>
            <Card className="flex items-center gap-3" data-persona={p.email}>
              <Avatar initials={initialsOf(p.name)} label={p.name} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span>{p.name}</span>
                <span className="text-caption text-ink-2">
                  {p.kind === 'newcomer'
                    ? t('devLogin.newcomer')
                    : p.kind === 'staff'
                      ? t('devLogin.staff')
                      : `${t(`roles.${p.role}`)} · ${p.orgSlug}`}
                </span>
              </div>
              {p.kind === 'staff' ? (
                // Staff work in the admin console (its own sign-in), never in an org here.
                <a href={adminSignInUrl()} className={buttonClass('secondary', 'sm')}>
                  {t('devLogin.openAdmin')}
                </a>
              ) : (
                <form action="/api/dev/login" method="post">
                  <input type="hidden" name="email" value={p.email} />
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" className={buttonClass('primary', 'sm')}>
                    {t('devLogin.signIn')}
                  </button>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
