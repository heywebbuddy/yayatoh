import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { PasskeyManager } from '@/components/passkeys.tsx';
import { Shell } from '@/components/shell.tsx';
import { getAuth } from '@/server/auth.ts';
import { requireStaff } from '@/server/staff.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('passkeys');
  return { title: t('metaTitle') };
}

/**
 * Staff passkeys (M1.2f, roadmap §10 "passkeys for staff"): sign in to the console with a passkey
 * that verifies the person (PIN or biometrics); it counts as both sign-in steps. Adding one needs
 * a sign-in in the last 10 minutes.
 */
export default async function SecurityPage() {
  const staff = await requireStaff();
  const t = await getTranslations('passkeys');
  const list = (await getAuth().api.listPasskeys({ headers: await headers() })) as {
    id: string;
    name?: string | null;
    createdAt?: Date | string | null;
  }[];
  const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <Card className="flex flex-col gap-4">
        <PasskeyManager
          passkeys={list.map((p) => ({
            id: p.id,
            name: p.name || t('unnamed'),
            createdAt: p.createdAt ? day.format(new Date(p.createdAt)) : '',
          }))}
        />
      </Card>
    </Shell>
  );
}
