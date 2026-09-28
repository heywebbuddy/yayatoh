import { buttonClass } from '@yayatoh/ui';
import { UserRoundCog } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Session } from '@/server/session.ts';
import { endImpersonationAction } from '@/server/session-actions.ts';

/**
 * Shown on every console page while platform staff act as a member (M1.2e): who they are acting
 * as, what is off, when it ends, and a button to end it now.
 */
export async function ImpersonationBanner({
  session,
  locale,
  timeZone,
}: {
  session: Session;
  locale: string;
  timeZone: string;
}) {
  const imp = session.impersonation;
  if (!imp) return null;
  const t = await getTranslations('impersonation');
  const until = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(imp.expiresAt);
  return (
    <section
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-3 border-b border-accent-700 bg-accent-50 px-4 py-2.5 text-accent-text md:px-8"
    >
      <UserRoundCog aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.6} />
      <p className="min-w-0 flex-1 text-body">
        {t('banner', { member: session.name, staff: imp.staffName, until })}
      </p>
      <form action={endImpersonationAction}>
        <button
          type="submit"
          aria-label={t('endLabel', { member: session.name })}
          className={buttonClass('primary', 'sm')}
        >
          {t('end')}
        </button>
      </form>
    </section>
  );
}
