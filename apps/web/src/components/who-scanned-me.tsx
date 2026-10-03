import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { whoScannedMeQuery } from '@yayatoh/leads';
import type { holderContext } from '@yayatoh/ticketing';
import { Card, EmptyState, SectionHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { setLeadSharingAction, withdrawLeadEmailAction } from '@/app/[locale]/my-tickets/[token]/actions.ts';
import { LeadSharingButton } from '@/components/lead-sharing-forms.tsx';
import { ports } from '@/server/ports.ts';

/**
 * The attendee's side of lead retrieval (M5.6b, P5-8) on their ticket page: the exhibitors that
 * scanned their badge (names and times only), whether each received their email, "stop sharing
 * my email" per exhibitor (the exhibitor keeps a stamped record that it was shared), and the
 * consent for scans from now on. Hidden when the org has no exhibitors module.
 */
export async function WhoScannedMe({
  token,
  holder,
  locale,
  timeZone,
}: {
  token: string;
  holder: NonNullable<Awaited<ReturnType<typeof holderContext>>>;
  locale: string;
  timeZone: string;
}) {
  const data = await executeQuery(whoScannedMeQuery, { linkId: holder.id }, holder.ctx, ports).catch(
    (err) => {
      if (isDomainError(err) && (err.code === 'module_not_enabled' || err.code === 'not_found')) return null;
      throw err;
    },
  );
  if (!data?.hasExhibitors) return null;
  const t = await getTranslations('leads.attendee');
  const when = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  return (
    <section aria-labelledby="who-scanned-heading" className="flex flex-col gap-3">
      <SectionHeader id="who-scanned-heading" title={t('heading')} count={data.scans.length} />
      {data.scans.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.scans.map((s) => (
            <li key={s.leadId}>
              <Card className="flex flex-col gap-2">
                <p className="m-0 text-body font-bold text-ink">{s.exhibitorName}</p>
                <p className="m-0 text-caption text-ink-2">
                  {t('scannedAt', { time: when.format(s.capturedAt) })}
                </p>
                <p className="m-0 flex flex-wrap items-center gap-2">
                  <StatusPill
                    tone={s.emailShared ? 'info' : 'neutral'}
                    label={
                      s.emailShared
                        ? t('emailShared')
                        : s.emailWithdrawn
                          ? t('emailWithdrawn')
                          : t('emailNotShared')
                    }
                  />
                </p>
                {s.emailShared ? (
                  <LeadSharingButton
                    action={withdrawLeadEmailAction.bind(null, token, s.leadId)}
                    label={t('withdraw', { exhibitor: s.exhibitorName })}
                    done={t('withdrawn')}
                  />
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card size="panel" className="flex flex-col gap-3">
        <p className="m-0 text-body">{data.emailSharing ? t('sharingOn') : t('sharingOff')}</p>
        <p className="m-0 text-caption text-ink-2">{t('sharingHint')}</p>
        <LeadSharingButton
          action={setLeadSharingAction.bind(null, token, !data.emailSharing)}
          label={data.emailSharing ? t('turnOff') : t('turnOn')}
          done={t('saved')}
        />
      </Card>
    </section>
  );
}
