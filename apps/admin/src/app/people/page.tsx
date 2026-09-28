import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PeopleConsole } from '@/components/people-console.tsx';
import { Shell } from '@/components/shell.tsx';
import { requireStaff } from '@/server/staff.ts';
import { erasePersonAction, exportPersonAction, findPersonAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('metaTitle') };
}

/** Data-subject requests about Yayatoh accounts (M1.14e): admin and support staff only. */
export default async function PeoplePage() {
  const staff = await requireStaff('privacy');
  const t = await getTranslations('people');
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <PeopleConsole find={findPersonAction} exportData={exportPersonAction} erase={erasePersonAction} />
    </Shell>
  );
}
