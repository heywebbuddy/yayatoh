import { Skeleton } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';

export default async function ConsoleLoading() {
  const t = await getTranslations('common');
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4 p-8">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
