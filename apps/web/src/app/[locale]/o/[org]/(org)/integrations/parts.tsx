import type { ConnectionStatus, RunStatus } from '@yayatoh/integrations/client';
import { StatusPill, type StatusTone, TabCount, Tabs, tabClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

const CONNECTION_TONE: Record<ConnectionStatus | 'none', StatusTone> = {
  none: 'neutral',
  pending: 'waiting',
  active: 'success',
  paused: 'info',
  revoked: 'danger',
  failed: 'danger',
};

const RUN_TONE: Record<RunStatus, StatusTone> = {
  queued: 'waiting',
  running: 'info',
  succeeded: 'success',
  partial: 'waiting',
  failed: 'danger',
  cancelled: 'neutral',
};

/** A connection's state, as a pill (dot plus text). */
export async function ConnectionPill({ status }: { status: ConnectionStatus | 'none' }) {
  const t = await getTranslations('integrations.status');
  return <StatusPill tone={CONNECTION_TONE[status]} label={t(status)} live={status === 'pending'} />;
}

export async function RunPill({ status }: { status: RunStatus }) {
  const t = await getTranslations('integrations.runStatus');
  return <StatusPill tone={RUN_TONE[status]} label={t(status)} live={status === 'running'} />;
}

/** Connections | Errors (with the open count). */
export async function IntegrationTabs({
  org,
  current,
  openErrors,
}: {
  org: string;
  current: 'connections' | 'errors';
  openErrors: number;
}) {
  const t = await getTranslations('integrations');
  return (
    <Tabs label={t('tabsLabel')} className="self-start">
      <Link
        href={`/o/${org}/integrations`}
        aria-current={current === 'connections' ? 'page' : undefined}
        className={tabClass(current === 'connections')}
      >
        {t('tabs.connections')}
      </Link>
      <Link
        href={`/o/${org}/integrations/errors`}
        aria-current={current === 'errors' ? 'page' : undefined}
        className={tabClass(current === 'errors')}
      >
        {t('tabs.errors')}
        <TabCount active={current === 'errors'}>{openErrors}</TabCount>
      </Link>
    </Tabs>
  );
}

/** Feedback after a redirect (`?error=`, `?done=`…): known codes only, never raw text. */
export const ERROR_CODES = new Set([
  'unavailable',
  'provider_unavailable',
  'not_approved',
  'denied',
  'expired',
  'validation_failed',
  'forbidden',
  'module_not_enabled',
  'not_found',
  'conflict',
  'invalid_state',
  'impersonation_blocked',
  'read_only_freeze',
  'internal',
]);

/** A sync code (`auth_revoked`, `invalid_value`, `http_503`…) in words; unknown codes say "error (code)". */
export function codeText(
  t: { has: (key: string) => boolean; (key: string, values?: Record<string, string>): string },
  code: string,
): string {
  return t.has(`codes.${code}`) ? t(`codes.${code}`) : t('codes.other', { code });
}
