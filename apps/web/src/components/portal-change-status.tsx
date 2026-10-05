import { Alert } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';

/** The outcome of the speaker's latest proposal for a profile or session (M5.3a). */
export async function PortalChangeStatus({
  change,
}: {
  change: { status: string; note: string | null; hasPhoto: boolean; changes: readonly { field: string }[] };
}) {
  const t = await getTranslations('speakerPortal');
  if (change.status === 'superseded') return null;
  const title =
    change.status === 'pending'
      ? t('changePending')
      : change.status === 'approved'
        ? t('changeApproved')
        : t('changeRejected');
  return (
    <Alert tone={change.status === 'rejected' ? 'danger' : 'info'} title={title}>
      {change.note ? <p>{t('changeNote', { note: change.note })}</p> : null}
    </Alert>
  );
}
