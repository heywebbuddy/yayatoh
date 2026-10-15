import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { PasskeyManager } from '@/components/passkeys.tsx';
import { Shell } from '@/components/shell.tsx';
import { StaffTwoFactor } from '@/components/staff-two-factor.tsx';
import { getAuth, getTwoFactor } from '@/server/auth.ts';
import { requireStaff } from '@/server/staff.ts';
import { staffTwoFactorAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staffTwoFactor');
  return { title: t('pageTitle') };
}

/**
 * The staff member's own sign-in security: their authenticator app (set up, another phone, backup
 * codes, turn off) and their passkeys.
 *
 * Staff passkeys (M1.2f, roadmap §10 "passkeys for staff"): sign in to the console with a passkey
 * that verifies the person (PIN or biometrics); it counts as both sign-in steps. Adding one needs
 * a sign-in in the last 10 minutes.
 */
export default async function SecurityPage() {
  const staff = await requireStaff();
  const t = await getTranslations('passkeys');
  const t2 = await getTranslations('staffTwoFactor');
  const status = await getTwoFactor().status(staff.userId);
  const list = (await getAuth().api.listPasskeys({ headers: await headers() })) as {
    id: string;
    name?: string | null;
    createdAt?: Date | string | null;
  }[];
  const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t2('pageTitle')} description={t2('pageDescription')} />
      <Card className="flex flex-col gap-4" id="two-factor">
        <h2 className="text-section">{t2('title')}</h2>
        <StaffTwoFactor
          action={staffTwoFactorAction}
          enabled={status.enabled}
          backupCodesLeft={status.backupCodesLeft}
          method={status.method}
        />
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('title')}</h2>
        <p className="text-body text-ink-2">{t('description')}</p>
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
