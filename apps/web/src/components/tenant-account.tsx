import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { getSession } from '@/server/session.ts';

/**
 * The account corner of a tenant site (M1.2d). Signing in happens on the app host ("Sign in"
 * goes there and comes back with a one-time code); the session here is this host's own.
 * Signing out ends this host's session only.
 */
export async function TenantAccount({ locale, path }: { locale: string; path: string }) {
  const t = await getTranslations('tenantAccount');
  const session = await getSession();
  const here = localizedPath(locale, path);
  if (!session)
    return (
      <a
        href={`${localizedPath(locale, '/sign-in')}?next=${encodeURIComponent(here)}`}
        className={buttonClass('secondary', 'sm')}
      >
        {t('signIn')}
      </a>
    );
  return (
    <form method="post" action={localizedPath(locale, '/auth/sign-out')} className="flex items-center gap-3">
      <input type="hidden" name="next" value={here} />
      <span className="text-caption text-zinc-600">{t('signedInAs', { name: session.name })}</span>
      <button type="submit" className={buttonClass('secondary', 'sm')}>
        {t('signOut')}
      </button>
    </form>
  );
}
