import type { PartyRsvpSummaryDto } from '@yayatoh/guests';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { createRsvpLinksAction, reopenRsvpAction, resetRsvpPinAction } from './rsvp/actions.ts';
import { CopyLink } from './rsvp/copy-link.tsx';

const pill = 'rounded-pill px-2 py-px text-caption';

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
      <p className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
        <span>{t('rsvpLabel')}</span>
        <span data-testid={`rsvp-state-${party.id}`} className={`${pill} bg-surface-3 text-ink-2`}>
          {t(`states.${summary.state}`)}
        </span>
        {summary.reopened ? (
          <span className={`${pill} bg-primary-soft text-primary-ink`}>{t('reopened')}</span>
        ) : null}
      </p>
      {summary.subEvents.length ? (
        <ul className="flex list-none flex-col gap-0.5 p-0 text-caption text-ink-2">
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
          <summary className="min-h-6 cursor-pointer py-0.5 text-caption text-ink-2 underline-offset-2 hover:underline">
            {label}
          </summary>
          <section aria-label={label} className="flex flex-col gap-3 pt-3">
            {url ? (
              <>
                <CopyLink label={t('linkLabel', { party: party.name })} url={url} />
                <Link
                  href={`/o/${org}/e/${event}/guests/rsvp/${party.id}`}
                  className="min-h-6 self-start py-1 text-caption underline"
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
