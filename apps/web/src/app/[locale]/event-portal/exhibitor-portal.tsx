import type { PortalPrincipal } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { leadSetupQuery } from '@yayatoh/leads';
import { portalExhibitorLogoQuery } from '@yayatoh/media';
import { exhibitorPortalQuery, portalLeadLicensesQuery } from '@yayatoh/program';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  fieldClass,
  Label,
  PageHeader,
  SectionHeader,
  StatusPill,
  Tag,
} from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { PortalFrame } from '@/components/portal-shell.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { inviteStaffAction, revokeStaffAction, saveProfileAction } from './exhibitor-actions.ts';
import { LeadLicensesSection } from './lead-licenses-section.tsx';
import { LeadsSection } from './leads-section.tsx';

const LOGO_RESULTS = ['saved', 'alt', 'file', 'too_large', 'unsupported', 'failed'] as const;
type LogoResult = (typeof LOGO_RESULTS)[number];

/**
 * The exhibitor portal (M5.4a; decision P5-7), shown at /event-portal to a signed-in exhibitor
 * admin or staff member (one portal sign-in for every role, M5.3a): an admin edits their profile
 * and logo, sees their booth and invites staff up to the allowance; staff see the exhibitor and
 * booth. Only the signed-in person's own exhibitor at their one event is ever read.
 */
export async function ExhibitorPortal({
  principal,
  locale,
  logoParam,
  paid = false,
  exportReady = false,
}: {
  principal: PortalPrincipal;
  locale: string;
  logoParam: string | undefined;
  paid?: boolean;
  exportReady?: boolean;
}) {
  const ctx = await portalRequestCtx(principal);
  const view = await executeQuery(exhibitorPortalQuery, {}, ctx, ports);
  const leads = await executeQuery(portalLeadLicensesQuery, {}, ctx, ports);
  // M5.6b: lead capture (license, window, terms, settings, export).
  const leadSetup = await executeQuery(leadSetupQuery, {}, ctx, ports);
  const logo = await executeQuery(portalExhibitorLogoQuery, {}, ctx, ports);
  const t = await getTranslations('exhibitorPortal');
  const tp = await getTranslations('program');
  const ts = await getTranslations('speakerPortal');
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
    <PortalFrame eventName={view.event.name}>
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={x.name}
        tag={<Tag>{t(`roles.${view.role}`)}</Tag>}
        description={t('signedInAs', { email: view.email, role: t(`roles.${view.role}`) })}
        meta={
          <span>
            {t('eventDates', {
              start: day.format(view.event.startsAt),
              end: day.format(view.event.endsAt),
            })}
          </span>
        }
      />

      <section aria-labelledby="booth-heading" className="flex flex-col gap-3">
        <SectionHeader id="booth-heading" title={t('boothHeading')} />
        {view.booths.length === 0 ? (
          <EmptyState title={t('noBoothTitle')} description={t('noBoothDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {view.booths.map((b) => (
              <li key={b.number}>
                <Card className="flex flex-wrap items-center gap-3">
                  <span className="text-card text-ink">{t('boothNumber', { number: b.number })}</span>
                  <span className="text-body text-ink-2 tabular-nums">
                    {t('boothSize', { width: b.width / 100, depth: b.height / 100 })}
                  </span>
                  <span className="ms-auto flex flex-wrap gap-2">
                    {b.category ? <Badge>{b.category}</Badge> : null}
                    <Badge tone={b.primary ? 'primary' : 'neutral'}>
                      {b.primary ? t('primary') : t('coExhibitor')}
                    </Badge>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
        <SectionHeader id="profile-heading" title={t('profileHeading')} />
        {!x.listed ? <Alert tone="info" title={t('unlisted')} /> : null}
        {view.pendingChange ? (
          <Alert tone="info" title={t('pendingTitle')}>
            {t('pendingDescription', { name: view.pendingChange.name })}
          </Alert>
        ) : null}
        {admin ? (
          <Card size="panel" className="flex flex-col gap-3">
            {view.approvalRequired ? <p className="text-caption text-ink-2">{t('approvalNotice')}</p> : null}
            <ProgramForm
              action={saveProfileAction}
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
            {x.websiteUrl ? <p className="text-body font-bold text-primary-ink">{x.websiteUrl}</p> : null}
            {x.description ? (
              <Markdown source={x.description} />
            ) : (
              <p className="text-body">{t('noDescription')}</p>
            )}
            {x.categories.length ? (
              <p className="text-caption text-ink-2">{x.categories.join(' · ')}</p>
            ) : null}
            <p className="text-caption text-ink-2">{t('staffReadOnly')}</p>
          </Card>
        )}
      </section>

      {admin ? (
        <section aria-labelledby="logo-heading" className="flex flex-col gap-3">
          <SectionHeader id="logo-heading" title={t('logoHeading')} />
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
                <label htmlFor="portal-logo-file" className="text-[13px] font-bold text-ink">
                  {t('logoFile')}
                </label>
                <input
                  id="portal-logo-file"
                  name="file"
                  type="file"
                  required
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  aria-describedby="portal-logo-hint"
                  className={fieldClass('md', 'py-2')}
                />
                <p id="portal-logo-hint" className="text-caption text-ink-2">
                  {t('logoHint')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="portal-logo-alt" className="text-[13px] font-bold text-ink">
                  {t('logoAlt')}
                </label>
                <input
                  id="portal-logo-alt"
                  name="alt"
                  type="text"
                  required
                  maxLength={300}
                  defaultValue={logo?.alt ?? t('logoAltDefault', { name: x.name })}
                  className={fieldClass()}
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
          <SectionHeader id="staff-heading" title={t('staffHeading')} />
          <p className="text-body text-ink-2 tabular-nums" role="status">
            {t('allowance', { used: view.staff.allowance.used, allowance: view.staff.allowance.allowance })}
          </p>
          <ul className="flex list-none flex-col gap-2 p-0">
            {view.staff.members.map((m) => (
              <li key={m.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar initials={(m.email[0] ?? '?').toUpperCase()} label={m.email} decorative />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-body font-bold text-ink">{m.email}</span>
                      <span className="text-caption text-ink-2">{t(`roles.${m.role}`)}</span>
                    </div>
                    <StatusPill
                      tone={
                        m.status === 'active' ? 'success' : m.status === 'pending' ? 'waiting' : 'neutral'
                      }
                      label={t(`statuses.${m.status}`)}
                    />
                  </div>
                  {m.role === 'exhibitor_staff' ? (
                    <form action={revokeStaffAction.bind(null, m.id)}>
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
            <h3 className="m-0 text-card text-ink">{t('inviteStaff')}</h3>
            <p className="text-caption text-ink-2">{t('inviteStaffHint')}</p>
            <ProgramForm
              action={inviteStaffAction}
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

      <LeadLicensesSection leads={leads} locale={locale} eventName={view.event.name} paid={paid} />

      <LeadsSection setup={leadSetup} locale={locale} exportReady={exportReady} />

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <SectionHeader id="tasks-heading" title={t('tasksHeading')} />
        {view.tasks.length === 0 ? (
          <EmptyState title={t('noTasksTitle')} description={t('noTasksDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {view.tasks.map((x) => (
              <li key={x.assigneeId}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-body font-bold text-ink">{x.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
                    {x.status === 'done' && x.completedAt ? (
                      <StatusPill
                        tone="success"
                        label={ts('completedOn', { date: day.format(x.completedAt) })}
                      />
                    ) : (
                      <>
                        <span>{ts('due', { date: day.format(x.dueAt) })}</span>
                        <StatusPill
                          tone={x.dueAt <= new Date() ? 'danger' : 'waiting'}
                          label={ts(x.dueAt <= new Date() ? 'overdue' : 'open')}
                        />
                      </>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalFrame>
  );
}
