import { myOrganizations } from '@yayatoh/tenancy';
import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { getSession } from '@/server/session.ts';
import { appOrigin } from '@/server/tenant-return.ts';

const linkClass = 'inline-flex min-h-6 items-center text-caption underline underline-offset-4';

/**
 * The account corner of a tenant site (M1.2d; event pages too since M1.2f). Signing in happens
 * on the app host ("Sign in" goes there and comes back with a one-time code); the session here is
 * this host's own. Signed in: who they are, their tickets at this organizer, and (members of this
 * org only) a link to its console on the app host. Nothing about other orgs is shown. Signing out
 * ends this host's session only.
 */
export async function TenantAccount({
  locale,
  path,
  orgId,
}: {
  locale: string;
  path: string;
  orgId?: string;
}) {
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
  const membership = orgId
    ? (await myOrganizations(session.userId)).find((m) => m.orgId === orgId)
    : undefined;
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center gap-3">
      <span className="text-caption text-zinc-600">{t('signedInAs', { name: session.name })}</span>
      {orgId ? (
        <a href={localizedPath(locale, '/tickets')} className={linkClass}>
          {t('tickets')}
        </a>
      ) : null}
      {membership ? (
        <a href={`${appOrigin()}${localizedPath(locale, `/o/${membership.slug}`)}`} className={linkClass}>
          {t('console')}
        </a>
      ) : null}
      <form method="post" action={localizedPath(locale, '/auth/sign-out')}>
        <input type="hidden" name="next" value={here} />
        <button type="submit" className={buttonClass('secondary', 'sm')}>
          {t('signOut')}
        </button>
      </form>
    </nav>
  );
}
