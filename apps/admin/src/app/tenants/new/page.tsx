import { PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { requireStaff } from '@/server/staff.ts';
import { NewTenantForm } from './form.tsx';

export default async function NewTenantPage() {
  const staff = await requireStaff('createTenant');
  const t = await getTranslations('newTenant');
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <NewTenantForm />
    </Shell>
  );
}
