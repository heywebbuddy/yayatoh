import { EmptyState } from '@yayatoh/ui';
import { Bell } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** Notification-centre shell (M1.1): a native popover; the inbox feed arrives with M1.10. */
export async function NotificationCenter() {
  const t = await getTranslations('notifications');
  return (
    <>
      <button
        type="button"
        popoverTarget="notification-center"
        aria-label={t('open')}
        className="flex size-10 items-center justify-center rounded-pill border border-zinc-200 bg-white hover:bg-zinc-50"
      >
        <Bell aria-hidden="true" className="size-4" strokeWidth={1.6} />
      </button>
      <div
        id="notification-center"
        popover="auto"
        role="dialog"
        aria-label={t('title')}
        className="m-0 w-[min(360px,calc(100vw-2rem))] rounded-panel border border-zinc-200 bg-white p-4 shadow-xl [inset:auto] [inset-block-start:72px] [inset-inline-end:16px]"
      >
        <p className="mb-3 text-section">{t('title')}</p>
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} className="py-8" />
      </div>
    </>
  );
}
