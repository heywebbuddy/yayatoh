import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { isDomainError } from '@yayatoh/kernel';
import { type PublicGroupDto, publicGroup } from '@yayatoh/registration';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { substituteAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registration.groupPage');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = { params: Promise<{ locale: string; slug: string; token: string }> };

/**
 * The payer's group page (M5.1c, by their signed link): the people they registered and, until each
 * type's cut-off, a form to hand a place to someone else (the ticket moves to them).
 */
export default async function GroupPage({ params }: Params) {
  const { locale, slug, token } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  let g: PublicGroupDto;
  try {
    g = await publicGroup(target.orgId, token);
  } catch (err) {
    if (isDomainError(err)) notFound();
    throw err;
  }
  const t = await getTranslations('registration.groupPage');
  const ta = await getTranslations('registration.applicant');
  const format = await getFormatter();
  const errors: Record<string, string> = {
    name: t('errors.name'),
    email: t('errors.email'),
    substitution_closed: t('errors.substitution_closed'),
    domain_not_allowed: t('errors.domain_not_allowed'),
    already_registered: t('errors.already_registered'),
    same_person: t('errors.same_person'),
    not_confirmed: t('errors.not_confirmed'),
  };
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('title')}
        description={g.paid ? t('description') : t('unpaid')}
      />
      <ul className="flex list-none flex-col gap-3 p-0">
        {g.members.map((m) => (
          <li key={m.id}>
            <Card className="flex flex-col gap-2">
              <h2 className="text-section">{m.name}</h2>
              <p className="text-body text-zinc-600">
                {m.email} · {m.typeName} · {ta(`status.${m.status}`)}
              </p>
              {m.canSubstitute ? (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-body underline underline-offset-2">
                    {t('replaceNamed', { name: m.name })}
                  </summary>
                  <div className="flex flex-col gap-3 pt-3">
                    <p className="text-caption text-zinc-600">
                      {t('replaceHint', {
                        until: format.dateTime(m.substitutionClosesAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: ev.timezone,
                        }),
                      })}
                    </p>
                    <ProgramForm
                      action={substituteAction.bind(null, slug, token, m.id)}
                      fields={[
                        { kind: 'text', name: 'name', label: t('newName'), required: true, maxLength: 120 },
                        { kind: 'text', name: 'email', label: t('newEmail'), required: true, maxLength: 254 },
                      ]}
                      idPrefix={`sub-${m.id}`}
                      submitLabel={t('replace')}
                      successLabel={t('replaced')}
                      errors={errors}
                    />
                  </div>
                </details>
              ) : m.status === 'confirmed' ? (
                <p className="text-caption text-zinc-600">{t('closed')}</p>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <Link href={`/events/${slug}`} className="self-start text-body underline underline-offset-2">
        {ta('backToEvent')}
      </Link>
    </main>
  );
}
