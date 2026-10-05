import { StatusDot } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';

/**
 * The door's "open signals" banner (M1.9e): a scanned ticket (or its order) has open
 * high-severity fraud signals. A count and what to do only; the fraud list has the details.
 */
export function SignalBanner({ count }: { count: number }) {
  const t = useTranslations('fraudSignals.door');
  if (count <= 0) return null;
  return (
    <div
      data-testid="signal-banner"
      className="flex flex-col gap-1 rounded-card border-2 border-danger bg-danger-soft px-4 py-3 text-danger"
    >
      <p className="text-body font-medium">
        <StatusDot status="danger" label={t('title', { count })} />
      </p>
      <p className="text-caption">{t('action')}</p>
    </div>
  );
}
