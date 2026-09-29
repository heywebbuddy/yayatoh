import { executeQuery } from '@yayatoh/kernel';
import {
  type ExhibitorPortalRowDto,
  exhibitorPortalAdminQuery,
  type ProfileProposalDto,
} from '@yayatoh/program';
import { Button, Card, Chip, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { siteTokenFor } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { requestHost } from '@/server/request-origin.ts';
import {
  decideChangeAction,
  inviteMemberAction,
  resendInviteAction,
  revokeMemberAction,
  saveListingAction,
  saveSettingsAction,
} from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

const DIFF_FIELDS = ['name', 'websiteUrl', 'description', 'links', 'categories'] as const;
const show = (p: ProfileProposalDto, k: (typeof DIFF_FIELDS)[number]) =>
  k === 'links'
    ? p.links.map((l) => `${l.label} | ${l.url}`).join('\n')
    : k === 'categories'
      ? p.categories.join(', ')
      : (p[k] ?? '');

/**
 * The exhibitor portal, organizer side (M5.4a): the event's portal settings (staff allowance,
 * approval), and per exhibitor its listing, people (invite, resend, revoke) and the profile
 * change waiting for approval, shown as a diff. Viewers see it all read-only.
 */
export default async function ExhibitorPortalAdminPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'exhibitors');
  const admin = await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('exhibitorAdmin');
  const tp = await getTranslations('program');
  const tr = await getTranslations('exhibitorPortal');
  const signInUrl = `${(await requestHost()).origin}/${locale}/exhibitor/sign-in/${siteTokenFor(data.org.id, ev.id)}`;
  const base = `/o/${org}/e/${event}`;
  return (
    <>
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`${base}/exhibitors`}
          className="inline-flex min-h-6 items-center text-caption text-zinc-600"
        >
          {t('back')}
        </Link>
      </nav>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {canWrite ? null : <p className="text-body text-zinc-500">{tp('viewerNotice')}</p>}

      <section aria-labelledby="portal-settings-heading" className="flex flex-col gap-3">
        <h2 id="portal-settings-heading" className="text-section">
          {t('settingsHeading')}
        </h2>
        <Card size="panel" className="flex flex-col gap-3">
          <p className="text-body">
            {t('settingsSummary', {
              allowance: admin.settings.defaultStaffAllowance,
              approval: admin.settings.approvalRequired ? 'yes' : 'no',
            })}
          </p>
          <p className="text-caption text-zinc-600">
            {t('signInPage')} <span className="break-all font-mono">{signInUrl}</span>
          </p>
          {canWrite ? (
            <ProgramForm
              action={saveSettingsAction.bind(null, org, event)}
              fields={[
                {
                  kind: 'number',
                  name: 'defaultStaffAllowance',
                  label: t('defaultAllowance'),
                  hint: t('defaultAllowanceHint'),
                  required: true,
                  defaultValue: String(admin.settings.defaultStaffAllowance),
                },
                {
                  kind: 'checkboxes',
                  name: 'approvalRequired',
                  label: t('approval'),
                  options: [{ value: '1', label: t('approvalRequired') }],
                  defaultValues: admin.settings.approvalRequired ? ['1'] : [],
                },
              ]}
              idPrefix="portal-settings"
              submitLabel={t('saveSettings')}
              successLabel={t('settingsSaved')}
              errors={{ defaultStaffAllowance: t('errors.allowance') }}
            />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="portal-exhibitors-heading" className="flex flex-col gap-3">
        <h2 id="portal-exhibitors-heading" className="text-section">
          {tp('exhibitorList', { count: admin.exhibitors.length })}
        </h2>
        {admin.exhibitors.length === 0 ? (
          <EmptyState
            title={tp('emptyExhibitorsTitle')}
            description={t('emptyDescription')}
            action={
              <Link href={`${base}/exhibitors`} className="text-body underline">
                {tp('addExhibitor')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {admin.exhibitors.map((x) => (
              <li key={x.exhibitorId}>
                <ExhibitorCard x={x} org={org} event={event} canWrite={canWrite} labels={{ t, tp, tr }} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function ExhibitorCard({
  x,
  org,
  event,
  canWrite,
  labels: { t, tp, tr },
}: {
  x: ExhibitorPortalRowDto;
  org: string;
  event: string;
  canWrite: boolean;
  labels: { t: T; tp: T; tr: T };
}) {
  const id = x.exhibitorId;
  const change = x.pendingChange;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`x-${id}`} className="text-body font-medium">
          {x.name}
        </h3>
        <Chip tone="neutral">{x.listed ? t('listed') : t('unlisted')}</Chip>
      </div>
      <p className="text-caption text-zinc-600">
        {t('staffUse', { used: x.staff.used, allowance: x.staff.allowance })}
        {x.staffAllowance === null ? ` · ${t('eventDefault')}` : ''}
        {x.categories.length ? ` · ${x.categories.join(', ')}` : ''}
      </p>

      {change ? (
        <section
          aria-labelledby={`change-${id}`}
          className="flex flex-col gap-2 rounded-card border border-accent-300 p-3"
        >
          <h4 id={`change-${id}`} className="text-body font-medium">
            {t('pendingChange', { name: x.name })}
          </h4>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1) */}
          <section tabIndex={0} aria-label={t('diffCaption', { name: x.name })} className="overflow-x-auto">
            <table className="w-full text-start text-caption">
              <caption className="sr-only">{t('diffCaption', { name: x.name })}</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 pe-3 text-start">
                    {t('field')}
                  </th>
                  <th scope="col" className="py-1 pe-3 text-start">
                    {t('current')}
                  </th>
                  <th scope="col" className="py-1 text-start">
                    {t('proposed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {DIFF_FIELDS.filter((k) => show(x.current, k) !== show(change.proposed, k)).map((k) => (
                  <tr key={k} className="border-t border-zinc-100 align-top">
                    <th scope="row" className="py-1 pe-3 text-start font-normal">
                      {t(`fields.${k}`)}
                    </th>
                    <td className="py-1 pe-3 whitespace-pre-wrap">{show(x.current, k) || '—'}</td>
                    <td className="py-1 whitespace-pre-wrap">{show(change.proposed, k) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {canWrite ? (
            <div className="flex flex-wrap items-start gap-4">
              <ProgramForm
                action={decideChangeAction.bind(null, org, event, change.id, 'approve')}
                fields={[]}
                idPrefix={`approve-${id}`}
                submitLabel={t('approveNamed', { name: x.name })}
                successLabel={t('approved')}
                errors={{}}
              />
              <ProgramForm
                action={decideChangeAction.bind(null, org, event, change.id, 'reject')}
                fields={[{ kind: 'text', name: 'reason', label: t('rejectReason'), maxLength: 500 }]}
                idPrefix={`reject-${id}`}
                submitLabel={t('rejectNamed', { name: x.name })}
                successLabel={t('rejected')}
                errors={{}}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby={`people-${id}`} className="flex flex-col gap-2">
        <h4 id={`people-${id}`} className="text-body font-medium">
          {t('people')}
        </h4>
        {x.members.length === 0 ? (
          <p className="text-caption text-zinc-500">{t('noPeople')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {x.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2">
                <span className="text-body">{m.email}</span>
                <span className="text-caption text-zinc-600">
                  {tr(`roles.${m.role}`)} · {tr(`statuses.${m.status}`)}
                </span>
                {canWrite ? (
                  <span className="ms-auto flex gap-2">
                    <form action={resendInviteAction.bind(null, org, event, m.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('resendNamed', { email: m.email })}
                      </Button>
                    </form>
                    <form action={revokeMemberAction.bind(null, org, event, m.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('revokeNamed', { email: m.email })}
                      </Button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <>
          <details className="border-t border-zinc-100 pt-2">
            <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
              {t('inviteNamed', { name: x.name })}
            </summary>
            <div className="pt-3">
              <ProgramForm
                action={inviteMemberAction.bind(null, org, event, id)}
                fields={[
                  { kind: 'text', name: 'email', label: tr('email'), required: true, maxLength: 254 },
                  {
                    kind: 'select',
                    name: 'role',
                    label: t('role'),
                    options: [
                      { value: 'exhibitor_admin', label: tr('roles.exhibitor_admin') },
                      { value: 'exhibitor_staff', label: tr('roles.exhibitor_staff') },
                    ],
                    defaultValue: 'exhibitor_admin',
                  },
                ]}
                idPrefix={`invite-${id}`}
                submitLabel={t('sendInvite')}
                successLabel={t('inviteSent')}
                errors={{
                  email: tr('errors.email'),
                  already_invited: tr('errors.already_invited'),
                  allowance_reached: tr('errors.allowance_reached', { allowance: x.staff.allowance }),
                  event_over: tr('errors.event_over'),
                }}
                reset
              />
            </div>
          </details>
          <details className="border-t border-zinc-100 pt-2">
            <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
              {t('listingNamed', { name: x.name })}
            </summary>
            <div className="pt-3">
              <ProgramForm
                action={saveListingAction.bind(null, org, event, id)}
                fields={[
                  {
                    kind: 'checkboxes',
                    name: 'listed',
                    label: t('visibility'),
                    options: [{ value: '1', label: t('listedLabel') }],
                    defaultValues: x.listed ? ['1'] : [],
                  },
                  {
                    kind: 'text',
                    name: 'categories',
                    label: tr('categories'),
                    hint: tr('categoriesHint'),
                    maxLength: 220,
                    defaultValue: x.categories.join(', '),
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
                    kind: 'number',
                    name: 'staffAllowance',
                    label: t('ownAllowance'),
                    hint: t('ownAllowanceHint'),
                    defaultValue: x.staffAllowance === null ? '' : String(x.staffAllowance),
                  },
                ]}
                idPrefix={`listing-${id}`}
                submitLabel={tp('save')}
                successLabel={tp('saved')}
                errors={{
                  staffAllowance: t('errors.allowance'),
                  links: tp('errors.links'),
                  categories: tr('errors.categories'),
                }}
              />
            </div>
          </details>
        </>
      ) : null}
    </Card>
  );
}
