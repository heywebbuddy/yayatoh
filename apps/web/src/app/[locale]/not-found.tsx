import { buttonClass, EmptyState } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-24">
      <EmptyState
        title={t('title')}
        description={t('description')}
        action={
          <Link href="/" className={buttonClass('secondary')}>
            {t('home')}
          </Link>
        }
      />
    </main>
  );
}
