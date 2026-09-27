import { EmptyState } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { SignOutButton } from '@/components/sign-out-button.tsx';

/** Signed in, but not on the staff list (or not allowed that action). */
export default async function NotStaffPage() {
  const t = await getTranslations('notStaff');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="sr-only">{t('title')}</h1>
      <EmptyState title={t('title')} description={t('description')} />
      <div className="self-center">
        <SignOutButton label={t('signOut')} />
      </div>
    </main>
  );
}
