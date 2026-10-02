import { Ban, CircleOff, FlaskConical } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Shown on every console page of a suspended or closed org (M1.3f): what happened, what still
 * works, and that the console is read-only. The staff note is never shown. A sandbox org (M6.3a)
 * gets its own banner on every page: test data, fake payments, never on the marketplace.
 */
export async function OrgStatusBanner({ status, sandbox = false }: { status: string; sandbox?: boolean }) {
  const t = await getTranslations('orgStatus');
  const sandboxBanner = sandbox ? (
    <section
      aria-label={t('sandbox.label')}
      data-testid="sandbox-banner"
      className="flex items-start gap-3 border-b border-accent-700/30 bg-accent-50 px-4 py-3 text-accent-text md:px-8"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-semibold tracking-wide">{t('sandbox.title')}</p>
        <p className="text-body">{t('sandbox.body')}</p>
      </div>
    </section>
  ) : null;
  if (status !== 'suspended' && status !== 'terminated') return sandboxBanner;
  const Icon = status === 'suspended' ? Ban : CircleOff;
  return (
    <>
      {sandboxBanner}
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
    </>
  );
}
