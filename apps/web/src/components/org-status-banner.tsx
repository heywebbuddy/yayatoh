import { Ban, CircleOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Shown on every console page of a suspended or closed org (M1.3f): what happened, what still
 * works, and that the console is read-only. The staff note is never shown.
 */
export async function OrgStatusBanner({ status }: { status: string }) {
  if (status !== 'suspended' && status !== 'terminated') return null;
  const t = await getTranslations('orgStatus');
  const Icon = status === 'suspended' ? Ban : CircleOff;
  return (
    <section
      aria-label={t('label')}
      className="flex items-start gap-3 border-b border-pink-700/30 bg-pink-50 px-4 py-3 text-pink-700 md:px-8"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-medium">{t(`${status}.title`)}</p>
        <p className="text-body">{t(`${status}.body`)}</p>
      </div>
    </section>
  );
}
