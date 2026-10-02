'use client';

import { authClient } from '@yayatoh/auth/client';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation.ts';

export function SignOutButton() {
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
      className="flex size-8 shrink-0 items-center justify-center rounded-pill text-ink-2 hover:bg-surface-3 hover:text-ink"
    >
      <LogOut aria-hidden="true" className="size-4" strokeWidth={2} />
    </button>
  );
}
