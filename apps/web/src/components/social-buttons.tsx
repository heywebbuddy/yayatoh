import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';

/**
 * "Continue with Google / Apple" (M1.2f): plain form posts to the start route (they work before
 * the page's scripts load), carrying where to go afterwards and, for a tenant site, the handoff
 * (M1.2d) so the person lands back there.
 */
export async function SocialButtons({
  providers,
  locale,
  next,
  handoff,
}: {
  providers: readonly ('google' | 'apple')[];
  locale: string;
  next: string;
  handoff: { returnUrl: string; state: string } | null;
}) {
  const t = await getTranslations('signIn.social');
  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => (
        <form key={p} method="post" action={localizedPath(locale, `/auth/social/${p}/start`)}>
          <input type="hidden" name="next" value={next} />
          {handoff ? (
            <>
              <input type="hidden" name="return" value={handoff.returnUrl} />
              <input type="hidden" name="state" value={handoff.state} />
            </>
          ) : null}
          <button type="submit" className={buttonClass('secondary', 'md', 'w-full')}>
            {t(`continueWith.${p}`)}
          </button>
        </form>
      ))}
      <p className="flex items-center gap-3 text-caption text-zinc-500">
        <span aria-hidden="true" className="h-px flex-1 bg-zinc-200" />
        {t('or')}
        <span aria-hidden="true" className="h-px flex-1 bg-zinc-200" />
      </p>
    </div>
  );
}
