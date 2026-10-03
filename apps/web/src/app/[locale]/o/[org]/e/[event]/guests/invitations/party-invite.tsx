import { partyRemindersQuery } from '@yayatoh/automations';
import {
  INVITE_LOCALES,
  partyContactQuery,
  partyInviteMessagesQuery,
  partyInvitesQuery,
} from '@yayatoh/guests';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { Alert, Card, CardHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { sendInvitationsAction, setPartyContactAction, setPartyLocaleAction } from './actions.ts';
import { DeliveryPill, languageName } from './delivery.tsx';

/**
 * A party's invitation on its RSVP page (M4.1f): where it can be reached (email and phone,
 * sealed on its primary guest), its language, sending (or sending again) its invitation, every
 * invitation and reminder message with its delivery state (a bounce or failure shows here), and
 * its deadline reminders (waiting, sent, or stopped because it answered).
 */
export async function PartyInvite({
  org,
  event,
  eventId,
  partyId,
  partyName,
  timeZone,
  locale,
  canWrite,
  ctx,
}: {
  org: string;
  event: string;
  eventId: string;
  partyId: string;
  partyName: string;
  timeZone: string;
  locale: string;
  canWrite: boolean;
  ctx: Ctx;
}) {
  const t = await getTranslations('invitations');
  const [contact, [invite], messages, reminders] = await Promise.all([
    executeQuery(partyContactQuery, { eventId, partyId }, ctx, ports),
    executeQuery(partyInvitesQuery, { eventId, partyIds: [partyId] }, ctx, ports),
    executeQuery(partyInviteMessagesQuery, { eventId, partyId }, ctx, ports),
    executeQuery(partyRemindersQuery, { eventId, partyId }, ctx, ports),
  ]);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const sent = messages.some((m) => m.kind === 'invitation');
  const channels = [
    ...(contact.email ? [{ value: 'email', label: t('channels.email') }] : []),
    ...(contact.phone ? [{ value: 'sms', label: t('channels.sms') }] : []),
  ];
  return (
    <section aria-labelledby="party-invite-heading" className="flex flex-col gap-3 print:hidden">
      <h2 id="party-invite-heading" className="m-0 text-section text-ink">
        {t('partyTitle')}
      </h2>
      {invite?.problem ? (
        <div data-testid="party-invite-problem">
          <Alert title={t('partyProblem')} />
        </div>
      ) : null}
      <Card size="panel" className="flex flex-col gap-4">
        {canWrite ? (
          <ProgramForm
            action={setPartyContactAction.bind(null, org, event, partyId)}
            fields={[
              {
                kind: 'text',
                name: 'email',
                label: t('email'),
                defaultValue: contact.email ?? '',
                maxLength: 254,
              },
              {
                kind: 'text',
                name: 'phone',
                label: t('phone'),
                hint: t('phoneHint'),
                defaultValue: contact.phone ?? '',
                maxLength: 40,
              },
            ]}
            idPrefix="party-contact"
            submitLabel={t('saveContact')}
            successLabel={t('contactSaved')}
            errors={{
              invalid_email: t('errors.email'),
              invalid_phone: t('errors.phone'),
              no_guests: t('errors.noGuests'),
            }}
          />
        ) : (
          <p className="m-0 text-body text-ink">
            {contact.email || contact.phone
              ? [contact.email ? t('channels.email') : null, contact.phone ? t('channels.sms') : null]
                  .filter(Boolean)
                  .join(', ')
              : t('noAddress')}
          </p>
        )}
        {canWrite ? (
          <ProgramForm
            action={setPartyLocaleAction.bind(null, org, event, partyId)}
            fields={[
              {
                kind: 'select',
                name: 'locale',
                label: t('partyLanguage'),
                options: INVITE_LOCALES.map((l) => ({ value: l, label: languageName(l, locale) })),
                defaultValue: invite?.locale ?? 'en',
              },
            ]}
            idPrefix="party-locale"
            submitLabel={t('saveLanguage')}
            successLabel={t('languageSaved')}
            errors={{}}
          />
        ) : (
          <p className="m-0 text-caption text-ink-2">{languageName(invite?.locale ?? 'en', locale)}</p>
        )}
        {canWrite ? (
          channels.length ? (
            <ProgramForm
              action={sendInvitationsAction.bind(null, org, event, partyId)}
              fields={[
                {
                  kind: 'checkboxes',
                  name: 'channels',
                  label: t('channelsLegend'),
                  options: channels,
                  defaultValues: channels.map((c) => c.value),
                },
              ]}
              idPrefix="party-send"
              submitLabel={sent ? t('sendAgain', { party: partyName }) : t('sendOne', { party: partyName })}
              successLabel={t('sentOne')}
              errors={{ channels: t('errors.channels') }}
            />
          ) : (
            <Alert tone="info" title={t('addAddressFirst')} />
          )
        ) : null}
      </Card>
      <Card className="flex flex-col gap-3">
        <CardHeader as="h3" title={t('messagesTitle')} />
        {messages.length === 0 ? (
          <p className="m-0 text-caption text-ink-2">{t('noMessages')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="party-messages">
            {messages.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 text-caption last:border-0"
              >
                <span className="font-bold text-ink">{t(`kinds.${m.kind}`)}</span>
                <DeliveryPill channel={m.channel} state={m.state} />
                <span className="ms-auto text-ink-2 tabular-nums">{fmt(m.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {reminders.length ? (
        <Card className="flex flex-col gap-3">
          <CardHeader as="h3" title={t('partyReminders')} />
          <ul className="m-0 flex list-none flex-col p-0 text-caption text-ink" data-testid="party-reminders">
            {reminders.map((r) => (
              <li key={r.id} className="border-b border-line py-2 tabular-nums last:border-0">
                {t('reminderLine', {
                  when: fmt(r.scheduledFor),
                  channel: t(`channels.${r.action === 'sms' ? 'sms' : 'email'}`),
                  state: t(`reminderStates.${r.outcome === 'responded' ? 'responded' : r.status}`),
                })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Link
        href={`/o/${org}/e/${event}/guests/invitations`}
        className="inline-flex min-h-8 items-center self-start rounded-[10px] text-caption font-bold text-primary-ink underline-offset-2 hover:underline"
      >
        {t('allInvitations')}
      </Link>
    </section>
  );
}
