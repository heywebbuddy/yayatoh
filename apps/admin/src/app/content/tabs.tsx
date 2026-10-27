import { Alert } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

const TABS = ['blog', 'testimonials', 'hero'] as const;

/** The three areas of "Site content", and the outcome of the last save (from the address). */
export async function ContentTabs({
  active,
  done,
  error,
}: {
  active: (typeof TABS)[number];
  done?: string;
  error?: string;
}) {
  const t = await getTranslations('platformContent');
  return (
    <>
      <nav aria-label={t('tabs.label')} className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/content/${k}`}
            aria-current={k === active ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-body font-bold text-ink-2 hover:bg-surface-3 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
      <div aria-live="polite" className="flex flex-col gap-2">
        {done ? <Alert tone="info" title={t(`done.${done}` as 'done.saved')} /> : null}
        {error ? <Alert title={t(`error.${error}` as 'error.invalid')} /> : null}
      </div>
    </>
  );
}
