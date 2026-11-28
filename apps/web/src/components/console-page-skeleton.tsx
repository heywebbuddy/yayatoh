import { Skeleton, SkeletonCard, SkeletonText } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';

/**
 * QA #8: what a console page shows the moment a sidebar link is clicked, while the server renders
 * it (the shell stays). Without it the click had no visible effect for a second or more on a slow
 * or distant connection, and people clicked again.
 */
export async function ConsolePageSkeleton() {
  const t = await getTranslations('common');
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-40 rounded-pill" />
        <Skeleton className="h-9 w-2/3 max-w-md" />
        <SkeletonText lines={1} className="max-w-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <SkeletonCard label={t('loading')} />
        <Skeleton className="h-[134px] rounded-card max-md:hidden" />
        <Skeleton className="h-[134px] rounded-card max-md:hidden" />
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}
