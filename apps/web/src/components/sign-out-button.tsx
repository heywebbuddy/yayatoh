'use client';

import { authClient } from '@yayatoh/auth/client';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation.ts';

export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations('shell');
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={t('signOut')}
      title={t('signOut')}
      onClick={async () => {
        await authClient.signOut();
        router.replace('/sign-in');
        router.refresh();
      }}
      className={
        className ??
        'flex size-9 shrink-0 items-center justify-center rounded-[12px] text-ink-2 hover:bg-surface-3 hover:text-ink'
      }
    >
      <LogOut aria-hidden="true" className="size-[18px]" strokeWidth={2} />
    </button>
  );
}
