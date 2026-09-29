import { executeQuery } from '@yayatoh/kernel';
import { portalExhibitorLogoQuery } from '@yayatoh/media';
import { exhibitorPortalQuery } from '@yayatoh/program';
import { Alert, Button, Card, Chip, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { currentPortalPrincipal, portalCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { inviteStaffAction, revokeStaffAction, saveProfileAction, signOutAction } from './actions.ts';

type Params = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ logo?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exhibitorPortal' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

const LOGO_RESULTS = ['saved', 'alt', 'file', 'too_large', 'unsupported', 'failed'] as const;
type LogoResult = (typeof LOGO_RESULTS)[number];

/**
 * The exhibitor portal (M5.4a; decision P5-7): an exhibitor admin edits their profile and logo,
 * sees their booth and invites staff up to the allowance; staff see the exhibitor and booth.
 * Only the signed-in member's own exhibitor at their one event is ever read.
 */
export default async function ExhibitorPortalPage({ params, searchParams }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const principal = await currentPortalPrincipal();
  if (!principal) redirect(`/${locale}/exhibitor/signed-out`);
  const ctx = portalCtx(principal, locale);
  const view = await executeQuery(exhibitorPortalQuery, { principal }, ctx, ports);
  const logo = await executeQuery(portalExhibitorLogoQuery, { principal }, ctx, ports);
  const t = await getTranslations('exhibitorPortal');
  const tp = await getTranslations('program');
  const logoParam = (await searchParams).logo;
  const logoResult = LOGO_RESULTS.includes(logoParam as LogoResult) ? (logoParam as LogoResult) : null;
  const admin = view.role === 'exhibitor_admin';
  const x = view.exhibitor;
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: view.event.timezone,
    dateStyle: 'medium',
  });
  const fields: FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('name'), required: true, maxLength: 120, defaultValue: x.name },
    { kind: 'url', name: 'websiteUrl', label: tp('website'), defaultValue: x.websiteUrl ?? undefined },
    {
      kind: 'textarea',
      name: 'description',
      label: tp('description'),
      hint: tp('markdownHint'),
      defaultValue: x.description,
    },
    {
      kind: 'textarea',
      name: 'links',
      label: tp('links'),
      hint: tp('linksHint'),
      rows: 3,
      defaultValue: x.links.map((l) => `${l.label} | ${l.url}`).join('\n'),
    },
    {
      kind: 'text',
      name: 'categories',
      label: t('categories'),
      hint: t('categoriesHint'),
      maxLength: 220,
      defaultValue: x.categories.join(', '),
    },
  ];
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10 md:px-6">
      <PageHeader
        eyebrow={<Label>{view.event.name}</Label>}
        title={x.name}
        description={t('signedInAs', { email: view.email, role: t(`roles.${view.role}`) })}
        actions={
          <form action={signOutAction.bind(null, locale)}>
            <Button type="submit" variant="secondary" size="sm">
              {t('signOut')}
            </Button>
          </form>
        }
      />
      <p className="text-body text-zinc-600">
        {t('eventDates', {
          start: day.format(view.event.startsAt),
          end: day.format(view.event.endsAt),
        })}
      </p>

      <section aria-labelledby="booth-heading" className="flex flex-col gap-3">
        <h2 id="booth-heading" className="text-section">
          {t('boothHeading')}
        </h2>
        {view.booths.length === 0 ? (
          <EmptyState title={t('noBoothTitle')} description={t('noBoothDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {view.booths.map((b) => (
              <li key={b.number}>
                <Card className="flex flex-wrap items-center gap-3">
                  <span className="text-body font-medium">{t('boothNumber', { number: b.number })}</span>
                  <span className="text-caption text-zinc-600">
                    {t('boothSize', { width: b.width / 100, depth: b.height / 100 })}
                  </span>
                  {b.category ? <Chip>{b.category}</Chip> : null}
                  <Chip>{b.primary ? t('primary') : t('coExhibitor')}</Chip>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
        <h2 id="profile-heading" className="text-section">
          {t('profileHeading')}
        </h2>
        {!x.listed ? <Alert tone="info" title={t('unlisted')} /> : null}
        {view.pendingChange ? (
          <Alert tone="info" title={t('pendingTitle')}>
            {t('pendingDescription', { name: view.pendingChange.name })}
          </Alert>
        ) : null}
        {admin ? (
          <Card size="panel" className="flex flex-col gap-3">
            {view.approvalRequired ? (
              <p className="text-caption text-zinc-600">{t('approvalNotice')}</p>
            ) : null}
            <ProgramForm
              action={saveProfileAction.bind(null, locale)}
              fields={fields}
              idPrefix="portal-profile"
              submitLabel={t('saveProfile')}
              successLabel={view.approvalRequired ? t('profileSubmitted') : t('profileSaved')}
              errors={{
                name: tp('errors.name'),
                websiteUrl: tp('errors.website'),
                links: tp('errors.links'),
                categories: t('errors.categories'),
              }}
            />
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            {x.websiteUrl ? <p className="text-body">{x.websiteUrl}</p> : null}
            {x.description ? (
              <Markdown source={x.description} />
            ) : (
              <p className="text-body">{t('noDescription')}</p>
            )}
            {x.categories.length ? (
              <p className="text-caption text-zinc-600">{x.categories.join(' · ')}</p>
            ) : null}
            <p className="text-caption text-zinc-500">{t('staffReadOnly')}</p>
          </Card>
        )}
      </section>

      {admin ? (
        <section aria-labelledby="logo-heading" className="flex flex-col gap-3">
          <h2 id="logo-heading" className="text-section">
            {t('logoHeading')}
          </h2>
          <Card size="panel" className="flex flex-col gap-3">
            <p className="text-body" aria-live="polite">
              {logo ? t('logoCurrent', { alt: logo.alt }) : t('noLogo')}
            </p>
            {logoResult === 'saved' ? <Alert tone="info" title={t('logoSaved')} /> : null}
            {logoResult && logoResult !== 'saved' ? <Alert title={t(`logoErrors.${logoResult}`)} /> : null}
            <form
              action="/api/portal/logo"
              method="post"
              encType="multipart/form-data"
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="locale" value={locale} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="portal-logo-file" className="text-caption text-zinc-600">
                  {t('logoFile')}
                </label>
                <input
                  id="portal-logo-file"
                  name="file"
                  type="file"
                  required
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  aria-describedby="portal-logo-hint"
                  className="min-h-10 text-body"
                />
                <p id="portal-logo-hint" className="text-caption text-zinc-500">
                  {t('logoHint')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="portal-logo-alt" className="text-caption text-zinc-600">
                  {t('logoAlt')}
                </label>
                <input
                  id="portal-logo-alt"
                  name="alt"
                  type="text"
                  required
                  maxLength={300}
                  defaultValue={logo?.alt ?? t('logoAltDefault', { name: x.name })}
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                />
              </div>
              <Button type="submit" className="self-start">
                {t('uploadLogo')}
              </Button>
            </form>
          </Card>
        </section>
      ) : null}

      {view.staff ? (
        <section aria-labelledby="staff-heading" className="flex flex-col gap-3">
          <h2 id="staff-heading" className="text-section">
            {t('staffHeading')}
          </h2>
          <p className="text-body" role="status">
            {t('allowance', { used: view.staff.allowance.used, allowance: view.staff.allowance.allowance })}
          </p>
          <ul className="flex list-none flex-col gap-2 p-0">
            {view.staff.members.map((m) => (
              <li key={m.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-body font-medium">{m.email}</span>
                    <span className="text-caption text-zinc-600">
                      {t(`roles.${m.role}`)} · {t(`statuses.${m.status}`)}
                    </span>
                  </div>
                  {m.role === 'exhibitor_staff' ? (
                    <form action={revokeStaffAction.bind(null, locale, m.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('revokeNamed', { email: m.email })}
                      </Button>
                    </form>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="text-body font-medium">{t('inviteStaff')}</h3>
            <p className="text-caption text-zinc-600">{t('inviteStaffHint')}</p>
            <ProgramForm
              action={inviteStaffAction.bind(null, locale)}
              fields={[
                { kind: 'text', name: 'email', label: t('staffEmail'), required: true, maxLength: 254 },
              ]}
              idPrefix="portal-invite"
              submitLabel={t('sendInvite')}
              successLabel={t('inviteSent')}
              errors={{
                email: t('errors.email'),
                already_invited: t('errors.already_invited'),
                allowance_reached: t('errors.allowance_reached', {
                  allowance: view.staff.allowance.allowance,
                }),
                event_over: t('errors.event_over'),
              }}
              reset
            />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <h2 id="tasks-heading" className="text-section">
          {t('tasksHeading')}
        </h2>
        <EmptyState title={t('noTasksTitle')} description={t('noTasksDescription')} />
      </section>
    </main>
  );
}
