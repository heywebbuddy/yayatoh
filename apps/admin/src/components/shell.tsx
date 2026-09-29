import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { autoPausedOrgs } from '@/server/messaging-policy.ts';
import type { Staff } from '@/server/staff.ts';
import { SignOutButton } from './sign-out-button.tsx';

/** The console frame: product name, sections, who is signed in and as what. */
export async function Shell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const t = await getTranslations('shell');
  // Staff hear about complaint-rate auto-pauses here (M3.5a): the count sits in the header.
  const paused = staff.can('messaging') ? (await autoPausedOrgs(staff)).length : 0;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only">
        {t('skip')}
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 bg-white px-6 py-3">
        <span className="text-[17px] font-semibold tracking-[-0.03em]">{t('product')}</span>
        <nav aria-label={t('nav')} className="flex gap-4 text-body">
          <Link href="/" className="underline-offset-2 hover:underline">
            {t('tenants')}
          </Link>
          {staff.can('fees') ? (
            <Link href="/commission" className="underline-offset-2 hover:underline">
              {t('commission')}
            </Link>
          ) : null}
          {staff.can('reports') ? (
            <Link href="/reports" className="underline-offset-2 hover:underline">
              {t('reports')}
            </Link>
          ) : null}
          {staff.can('signupCodes') ? (
            <Link href="/signup-codes" className="underline-offset-2 hover:underline">
              {t('signupCodes')}
            </Link>
          ) : null}
          {staff.can('privacy') ? (
            <Link href="/people" className="underline-offset-2 hover:underline">
              {t('people')}
            </Link>
          ) : null}
          {staff.can('messaging') ? (
            <Link href="/messaging" className="underline-offset-2 hover:underline">
              {paused ? t('messagingCount', { count: paused }) : t('messaging')}
            </Link>
          ) : null}
          <Link href="/access-log" className="underline-offset-2 hover:underline">
            {t('accessLog')}
          </Link>
          <Link href="/api-usage" className="underline-offset-2 hover:underline">
            {t('apiUsage')}
          </Link>
          <Link href="/security" className="underline-offset-2 hover:underline">
            {t('passkeys')}
          </Link>
        </nav>
        <span className="ms-auto text-caption text-zinc-600">
          {t('signedInAs', { name: staff.name, role: t(`roles.${staff.role}`) })}
        </span>
        <SignOutButton label={t('signOut')} />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
