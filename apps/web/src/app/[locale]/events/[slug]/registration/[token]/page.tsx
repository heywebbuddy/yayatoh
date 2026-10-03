import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { isDomainError } from '@yayatoh/kernel';
import { type PublicRegistrantDto, publicRegistrant } from '@yayatoh/registration';
import { Alert, Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { addGuestAction, payApprovedAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registration.applicant');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = { params: Promise<{ locale: string; slug: string; token: string }> };

/**
 * An applicant's or registrant's own page (M5.1c, by their signed link): where their application
 * stands, the organizer's reason, the pay step once approved, and their +1. Phone-first; one
 * primary action.
 */
export default async function RegistrantPage({ params }: Params) {
  const { locale, slug, token } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  let r: PublicRegistrantDto;
  try {
    r = await publicRegistrant(target.orgId, token);
  } catch (err) {
    if (isDomainError(err)) notFound();
    throw err;
  }
  const t = await getTranslations('registration.applicant');
  const errors: Record<string, string> = {
    name: t('errors.name'),
    email: t('errors.email'),
    guest_limit: t('errors.guest_limit'),
    guest_is_host: t('errors.guest_is_host'),
    type_full: t('errors.type_full'),
    not_approved: t('errors.not_approved'),
    already_confirmed: t('errors.already_confirmed'),
  };
  const passes = r.guestTypes.flatMap((g) =>
    g.items.map((i) => ({ value: `${g.id}:${i.id}`, label: `${g.name} · ${i.name}` })),
  );
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t(`title.${r.status}`)}
        description={t(`lead.${r.status}`, { name: r.name })}
      />
      <Card className="flex flex-col gap-2">
        <h2 className="text-section">{t('yourRegistration')}</h2>
        <p className="text-body">
          {r.name} · {r.typeName} · {r.itemName}
        </p>
        <p className="text-caption text-ink-2">{t('statusLine', { status: t(`status.${r.status}`) })}</p>
        {r.reason ? (
          <Alert tone="info" title={t('reasonTitle')}>
            {r.reason}
          </Alert>
        ) : null}
      </Card>
      {r.status === 'approved' ? (
        <section aria-labelledby="pay-heading">
          <Card className="flex flex-col gap-3">
            <h2 id="pay-heading" className="text-section">
              {t('payTitle')}
            </h2>
            <p className="text-body text-ink-2">{r.paying ? t('payingHint') : t('payHint')}</p>
            <ProgramForm
              action={payApprovedAction.bind(null, slug, token)}
              fields={[]}
              idPrefix="pay"
              submitLabel={t('pay')}
              successLabel={t('paid')}
              errors={errors}
            />
          </Card>
        </section>
      ) : null}
      {r.status === 'confirmed' && (r.guestTypes.length > 0 || r.guests.length > 0) ? (
        <section aria-labelledby="guest-heading">
          <Card className="flex flex-col gap-3">
            <h2 id="guest-heading" className="text-section">
              {t('guestTitle')}
            </h2>
            {r.guests.length > 0 ? (
              <ul className="flex flex-col gap-1 ps-5">
                {r.guests.map((g) => (
                  <li key={`${g.name}-${g.status}`} className="list-disc text-body">
                    {g.name} · {t(`status.${g.status}`)}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.guestsLeft > 0 && passes.length > 0 ? (
              <>
                <p className="text-body text-ink-2">{t('guestHint', { count: r.guestsLeft })}</p>
                <ProgramForm
                  action={addGuestAction.bind(null, slug, token)}
                  fields={[
                    { kind: 'text', name: 'name', label: t('guestName'), required: true, maxLength: 120 },
                    { kind: 'text', name: 'email', label: t('guestEmail'), required: true, maxLength: 254 },
                    { kind: 'select', name: 'pass', label: t('guestPass'), options: passes },
                  ]}
                  idPrefix="guest"
                  submitLabel={t('addGuest')}
                  successLabel={t('guestAdded')}
                  errors={errors}
                  reset
                />
              </>
            ) : (
              <p className="text-body text-ink-2">{t('noGuestsLeft')}</p>
            )}
          </Card>
        </section>
      ) : null}
      {r.groupToken ? (
        <Link
          href={`/events/${slug}/group/${r.groupToken}`}
          className="self-start text-body underline underline-offset-2"
        >
          {t('manageGroup')}
        </Link>
      ) : null}
      <Link href={`/events/${slug}`} className="self-start text-body underline underline-offset-2">
        {t('backToEvent')}
      </Link>
    </main>
  );
}
