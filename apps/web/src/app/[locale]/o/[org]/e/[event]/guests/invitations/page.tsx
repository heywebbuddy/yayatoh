import { rsvpRemindersQuery } from '@yayatoh/automations';
import {
  guestListQuery,
  INVITE_LOCALES,
  INVITE_MESSAGE_MAX,
  INVITE_SMS_MAX,
  INVITE_SUBJECT_MAX,
  type InviteLocale,
  invitationPreviewQuery,
  invitationTemplatesQuery,
  partyInvitesQuery,
  rsvpOverviewQuery,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  resetTemplateAction,
  saveTemplateAction,
  sendInvitationsAction,
  setRemindersAction,
  testSendAction,
} from './actions.ts';
import { DeliveryPill, languageName } from './delivery.tsx';

const pill = 'rounded-pill px-2 py-px text-caption';
const control = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/**
 * Invitations (M4.1f): send every party its invitation by email and/or text with its own RSVP
 * link (the primary action), the event's wording per language with a preview and a test to
 * yourself, the deadline reminders (on the journey engine: they stop once a party answers and
 * wait for quiet hours), and every party's state with bounced or failed messages called out.
 * `guests:write` sends and edits; viewers read.
 */
export default async function InvitationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { locale, org, event } = await params;
  const { lang } = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('invitations');
  const canWrite = can('guests:write');
  const wording: InviteLocale = (INVITE_LOCALES as readonly string[]).includes(lang ?? '')
    ? (lang as InviteLocale)
    : (INVITE_LOCALES as readonly string[]).includes(locale)
      ? (locale as InviteLocale)
      : 'en';
  const [list, ov, invites, templates, reminders] = await Promise.all([
    executeQuery(guestListQuery, { eventId: ev.id, limit: 1 }, data.ctx, ports),
    executeQuery(rsvpOverviewQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(partyInvitesQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(invitationTemplatesQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(rsvpRemindersQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const firstParty = list.partyOptions[0]?.id;
  const preview = await executeQuery(
    invitationPreviewQuery,
    { eventId: ev.id, locale: wording, ...(firstParty ? { partyId: firstParty } : {}) },
    data.ctx,
    ports,
  );
  const template = templates.find((x) => x.locale === wording);
  const names = new Map(list.partyOptions.map((p) => [p.id, p.name]));
  const state = new Map(ov.parties.map((p) => [p.partyId, p.state]));
  const notSent = ov.parties.filter((p) => p.state === 'invited').map((p) => p.partyId);
  const unreachable = invites.filter((i) => !i.hasEmail && !i.hasPhone).length;
  const problems = invites.filter((i) => i.problem).length;
  const base = `/o/${org}/e/${event}/guests`;
  const deadline = ov.settings.deadline
    ? new Intl.DateTimeFormat(locale, {
        timeZone: ev.timezone,
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(ov.settings.deadline)
    : null;
  const channelOptions = [
    { value: 'email', label: t('channels.email') },
    { value: 'sms', label: t('channels.sms') },
  ];

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Link href={base} className="min-h-6 self-start py-1 text-caption underline">
        {t('back')}
      </Link>
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}

      <section aria-labelledby="invite-send-heading" className="flex flex-col gap-3">
        <h2 id="invite-send-heading" className="text-section">
          {t('sendTitle')}
        </h2>
        {list.partyOptions.length === 0 ? (
          <EmptyState
            title={t('noPartiesTitle')}
            description={t('noParties')}
            action={
              <Link href={base} className="min-h-6 py-1 text-caption underline">
                {t('addGuests')}
              </Link>
            }
          />
        ) : (
          <Card size="panel" className="flex flex-col gap-3">
            <p className="text-body" data-testid="invite-not-sent">
              {t('notSent', { count: notSent.length })}
            </p>
            {unreachable > 0 ? (
              <p className="text-caption text-zinc-600">{t('unreachable', { count: unreachable })}</p>
            ) : null}
            {problems > 0 ? (
              <p className="text-caption text-pink-700" data-testid="invite-problems">
                {t('problems', { count: problems })}
              </p>
            ) : null}
            {canWrite && notSent.length > 0 ? (
              <ProgramForm
                action={sendInvitationsAction.bind(null, org, event, null)}
                fields={[
                  {
                    kind: 'checkboxes',
                    name: 'channels',
                    label: t('channelsLegend'),
                    options: channelOptions,
                    defaultValues: ['email'],
                  },
                ]}
                idPrefix="invite-send"
                submitLabel={t('sendAll', { count: notSent.length })}
                successLabel={t('sent')}
                errors={{ channels: t('errors.channels') }}
              />
            ) : null}
          </Card>
        )}
      </section>

      <section aria-labelledby="invite-wording-heading" className="flex flex-col gap-3">
        <h2 id="invite-wording-heading" className="text-section">
          {t('wordingTitle')}
        </h2>
        <p className="text-caption text-zinc-600">{t('wordingHint')}</p>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-lang" className="text-caption text-zinc-600">
              {t('language')}
            </label>
            <select id="invite-lang" name="lang" defaultValue={wording} className={control}>
              {INVITE_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {languageName(l, locale)}
                  {templates.find((x) => x.locale === l)?.custom ? ` · ${t('edited')}` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            {t('showLanguage')}
          </Button>
        </form>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="text-body font-medium">
              {t('editTitle', { language: languageName(wording, locale) })}
              {template?.custom ? ` · ${t('edited')}` : ` · ${t('builtIn')}`}
            </h3>
            {canWrite && template ? (
              <>
                <ProgramForm
                  key={wording}
                  action={saveTemplateAction.bind(null, org, event, wording)}
                  fields={[
                    {
                      kind: 'text',
                      name: 'subject',
                      label: t('subject'),
                      defaultValue: template.subject,
                      maxLength: INVITE_SUBJECT_MAX,
                    },
                    {
                      kind: 'textarea',
                      name: 'message',
                      label: t('message'),
                      hint: t('placeholders'),
                      defaultValue: template.message,
                      rows: 6,
                    },
                    {
                      kind: 'textarea',
                      name: 'smsText',
                      label: t('smsText'),
                      hint: t('smsHint', { max: INVITE_SMS_MAX }),
                      defaultValue: template.smsText,
                      rows: 2,
                    },
                  ]}
                  idPrefix="invite-wording"
                  submitLabel={t('saveWording')}
                  successLabel={t('wordingSaved')}
                  errors={{
                    subject: t('errors.subject', { max: INVITE_SUBJECT_MAX }),
                    message: t('errors.message', { max: INVITE_MESSAGE_MAX }),
                    smsText: t('errors.smsText', { max: INVITE_SMS_MAX }),
                  }}
                />
                {template.custom ? (
                  <ProgramForm
                    key={`reset-${wording}`}
                    action={resetTemplateAction.bind(null, org, event, wording)}
                    fields={[]}
                    idPrefix="invite-reset"
                    submitLabel={t('reset')}
                    successLabel={t('wasReset')}
                    errors={{}}
                  />
                ) : null}
              </>
            ) : null}
          </Card>
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="text-body font-medium">{t('previewTitle')}</h3>
            <p className="text-caption text-zinc-600">
              {preview.partyName ? t('previewFor', { party: preview.partyName }) : t('previewSample')}
            </p>
            <figure
              className="flex flex-col gap-2 rounded-card border border-zinc-200 p-3"
              lang={wording}
              dir={wording === 'ar' ? 'rtl' : 'ltr'}
              aria-label={t('emailPreview')}
            >
              <figcaption className="text-caption text-zinc-600">{t('emailPreview')}</figcaption>
              <p className="text-body font-medium" data-testid="preview-subject">
                {preview.subject}
              </p>
              <p className="whitespace-pre-line text-body" data-testid="preview-message">
                {preview.message}
              </p>
              <p className="text-caption text-zinc-600">{t('previewLink')}</p>
            </figure>
            <figure
              className="flex flex-col gap-2 rounded-card border border-zinc-200 p-3"
              lang={wording}
              dir={wording === 'ar' ? 'rtl' : 'ltr'}
              aria-label={t('smsPreview')}
            >
              <figcaption className="text-caption text-zinc-600">{t('smsPreview')}</figcaption>
              <p className="text-body" data-testid="preview-sms">
                {preview.smsText}
              </p>
            </figure>
            {canWrite ? (
              <ProgramForm
                key={`test-${wording}`}
                action={testSendAction.bind(null, org, event, wording)}
                fields={[]}
                idPrefix="invite-test"
                submitLabel={t('testSend')}
                successLabel={t('testSent')}
                errors={{}}
              />
            ) : null}
          </Card>
        </div>
      </section>

      <section aria-labelledby="invite-reminders-heading" className="flex flex-col gap-3">
        <h2 id="invite-reminders-heading" className="text-section">
          {t('remindersTitle')}
        </h2>
        <Card size="panel" className="flex flex-col gap-3">
          <p className="text-body" data-testid="reminders-state">
            {reminders.enabled
              ? t('remindersOn', {
                  days: reminders.days.join(', '),
                  channels: reminders.channels.map((c) => t(`channels.${c}`)).join(', '),
                })
              : t('remindersOff')}
          </p>
          <p className="text-caption text-zinc-600">{t('remindersHint')}</p>
          {reminders.enabled ? (
            <p className="text-caption text-zinc-600">
              {t('remindersCounts', {
                pending: reminders.counts.pending ?? 0,
                done: reminders.counts.done ?? 0,
                cancelled: reminders.counts.cancelled ?? 0,
              })}
            </p>
          ) : null}
          {deadline ? (
            <p className="text-caption text-zinc-600">{t('deadlineIs', { deadline })}</p>
          ) : (
            <p className="text-caption text-zinc-600">
              {t('noDeadline')}{' '}
              <Link href={`${base}/rsvp`} className="min-h-6 py-1 underline">
                {t('setDeadline')}
              </Link>
            </p>
          )}
          {canWrite && reminders.hasDeadline ? (
            <ProgramForm
              key={`rem-${reminders.enabled}-${reminders.days.join('-')}-${reminders.channels.join('-')}`}
              action={setRemindersAction.bind(null, org, event, true)}
              fields={[
                {
                  kind: 'text',
                  name: 'days',
                  label: t('daysLabel'),
                  hint: t('daysHint'),
                  defaultValue: reminders.days.join(', '),
                  maxLength: 30,
                },
                {
                  kind: 'checkboxes',
                  name: 'channels',
                  label: t('channelsLegend'),
                  options: channelOptions,
                  defaultValues: reminders.channels,
                },
              ]}
              idPrefix="reminders"
              submitLabel={reminders.enabled ? t('remindersSave') : t('remindersEnable')}
              successLabel={t('remindersSaved')}
              errors={{
                days: t('errors.days'),
                channels: t('errors.channels'),
                no_deadline: t('noDeadline'),
              }}
            />
          ) : null}
          {canWrite && reminders.enabled ? (
            <ProgramForm
              action={setRemindersAction.bind(null, org, event, false)}
              fields={[]}
              idPrefix="reminders-off"
              submitLabel={t('remindersDisable')}
              successLabel={t('remindersDisabled')}
              errors={{}}
            />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="invite-parties-heading" className="flex flex-col gap-3">
        <h2 id="invite-parties-heading" className="text-section">
          {t('partiesTitle', { count: invites.length })}
        </h2>
        {invites.length === 0 ? (
          <EmptyState title={t('noPartiesTitle')} description={t('noParties')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {invites.map((i) => {
              const name = names.get(i.partyId) ?? '';
              const st = state.get(i.partyId) ?? 'invited';
              return (
                <li key={i.partyId}>
                  <Card className="flex flex-col gap-2" data-testid={`invite-party-${i.partyId}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-body font-medium">{name}</h3>
                      <span
                        className={`${pill} bg-zinc-100 text-zinc-700`}
                        data-testid={`invite-state-${i.partyId}`}
                      >
                        {t(`states.${st}`)}
                      </span>
                      {i.problem ? (
                        <span className={`${pill} bg-pink-50 text-pink-700`}>{t('problem')}</span>
                      ) : null}
                    </div>
                    <p className="text-caption text-zinc-600">
                      {languageName(i.locale, locale)} ·{' '}
                      {i.hasEmail || i.hasPhone
                        ? [i.hasEmail ? t('channels.email') : null, i.hasPhone ? t('channels.sms') : null]
                            .filter(Boolean)
                            .join(', ')
                        : t('noAddress')}
                    </p>
                    {i.latest.length ? (
                      <ul className="flex list-none flex-wrap gap-2 p-0">
                        {i.latest.map((m) => (
                          <li key={m.id}>
                            <DeliveryPill channel={m.channel} state={m.state} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Link
                      href={`${base}/rsvp/${i.partyId}`}
                      className="min-h-6 self-start py-1 text-caption underline"
                    >
                      {canWrite ? t('manage', { party: name }) : t('view', { party: name })}
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-caption text-zinc-600">{t('privacy')}</p>
    </>
  );
}
