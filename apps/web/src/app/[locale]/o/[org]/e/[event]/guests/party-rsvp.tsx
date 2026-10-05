import type { PartyRsvpSummaryDto } from '@yayatoh/guests';
import { StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { createRsvpLinksAction, reopenRsvpAction, resetRsvpPinAction } from './rsvp/actions.ts';
import { CopyLink } from './rsvp/copy-link.tsx';

/** RSVP states as dot + word (ADR 0022): not sent yet, on its way, opened, answered. */
export const RSVP_STATE_TONE = {
  invited: 'neutral',
  sent: 'info',
  viewed: 'waiting',
  responded: 'success',
} as const;

/**
 * A party's RSVP on the Guests page (M4.1d): its state and the answers per sub-event, and for
 * hosts who edit guests a menu: copy the link, show the QR code and PIN, reset the PIN, reopen
 * after the deadline. Sending invitations by email and text is M4.1f.
 */
export async function PartyRsvp({
  org,
  event,
  party,
  summary,
  url,
  canWrite,
  locked,
  subName,
}: {
  org: string;
  event: string;
  party: { id: string; name: string };
  summary: PartyRsvpSummaryDto | undefined;
  url: string | null;
  canWrite: boolean;
  locked: boolean;
  subName: ReadonlyMap<string, string>;
}) {
  const t = await getTranslations('rsvpHost');
  if (!summary) return null;
  const label = t('menu', { party: party.name });
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <p className="m-0 flex flex-wrap items-center gap-2 text-caption font-bold text-ink-2">
        <span>{t('rsvpLabel')}</span>
        <span data-testid={`rsvp-state-${party.id}`} className="inline-flex">
          <StatusPill tone={RSVP_STATE_TONE[summary.state]} label={t(`states.${summary.state}`)} />
        </span>
        {summary.reopened ? <StatusPill tone="brand" label={t('reopened')} /> : null}
      </p>
      {summary.subEvents.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-caption text-ink-2 tabular-nums">
          {summary.subEvents.map((s) => (
            <li key={s.subEventId}>
              {t('tally', {
                name: subName.get(s.subEventId) ?? '',
                attending: s.attending,
                declined: s.declined,
                awaiting: s.awaiting,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        <details className="group">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-caption font-bold text-primary-ink hover:bg-surface-3">
            {label}
          </summary>
          <section aria-label={label} className="flex flex-col gap-3 pt-3">
            {url ? (
              <>
                <CopyLink label={t('linkLabel', { party: party.name })} url={url} />
                <Link
                  href={`/o/${org}/e/${event}/guests/rsvp/${party.id}`}
                  className="inline-flex min-h-8 items-center self-start rounded-[10px] text-caption font-bold text-primary-ink underline-offset-2 hover:underline"
                >
                  {t('showQr', { party: party.name })}
                </Link>
                <ProgramForm
                  action={resetRsvpPinAction.bind(null, org, event, party.id)}
                  fields={[]}
                  idPrefix={`rsvp-pin-${party.id}`}
                  submitLabel={t('resetPinFor', { party: party.name })}
                  successLabel={t('pinReset')}
                  errors={{}}
                />
                {locked && !summary.reopened ? (
                  <ProgramForm
                    action={reopenRsvpAction.bind(null, org, event, party.id)}
                    fields={[]}
                    idPrefix={`rsvp-reopen-${party.id}`}
                    submitLabel={t('reopenFor', { party: party.name })}
                    successLabel={t('reopenedDone')}
                    errors={{}}
                  />
                ) : null}
              </>
            ) : (
              <ProgramForm
                action={createRsvpLinksAction.bind(null, org, event, party.id)}
                fields={[]}
                idPrefix={`rsvp-create-${party.id}`}
                submitLabel={t('createLinkFor', { party: party.name })}
                successLabel={t('linkCreated')}
                errors={{}}
              />
            )}
          </section>
        </details>
      ) : null}
    </div>
  );
}
