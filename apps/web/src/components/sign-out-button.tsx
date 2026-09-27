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
      className="ms-auto flex size-8 shrink-0 items-center justify-center rounded-pill text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      <LogOut aria-hidden="true" className="size-4" strokeWidth={1.6} />
    </button>
  );
}
