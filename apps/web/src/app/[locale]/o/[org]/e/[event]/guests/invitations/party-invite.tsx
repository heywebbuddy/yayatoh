import { partyRemindersQuery } from '@yayatoh/automations';
import {
  INVITE_LOCALES,
  partyContactQuery,
  partyInviteMessagesQuery,
  partyInvitesQuery,
} from '@yayatoh/guests';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { Card } from '@yayatoh/ui';
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
      <h2 id="party-invite-heading" className="text-section">
        {t('partyTitle')}
      </h2>
      {invite?.problem ? (
        <p className="text-body text-danger" data-testid="party-invite-problem">
          {t('partyProblem')}
        </p>
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
          <p className="text-body">
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
          <p className="text-caption text-ink-2">{languageName(invite?.locale ?? 'en', locale)}</p>
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
            <p className="text-caption text-ink-2">{t('addAddressFirst')}</p>
          )
        ) : null}
      </Card>
      <h3 className="text-body font-medium">{t('messagesTitle')}</h3>
      {messages.length === 0 ? (
        <p className="text-caption text-ink-2">{t('noMessages')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-1 p-0" data-testid="party-messages">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 text-caption">
              <span>{t(`kinds.${m.kind}`)}</span>
              <DeliveryPill channel={m.channel} state={m.state} />
              <span className="text-ink-2">{fmt(m.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {reminders.length ? (
        <>
          <h3 className="text-body font-medium">{t('partyReminders')}</h3>
          <ul className="flex list-none flex-col gap-1 p-0 text-caption" data-testid="party-reminders">
            {reminders.map((r) => (
              <li key={r.id}>
                {t('reminderLine', {
                  when: fmt(r.scheduledFor),
                  channel: t(`channels.${r.action === 'sms' ? 'sms' : 'email'}`),
                  state: t(`reminderStates.${r.outcome === 'responded' ? 'responded' : r.status}`),
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Link
        href={`/o/${org}/e/${event}/guests/invitations`}
        className="min-h-6 self-start py-1 text-caption underline"
      >
        {t('allInvitations')}
      </Link>
    </section>
  );
}
