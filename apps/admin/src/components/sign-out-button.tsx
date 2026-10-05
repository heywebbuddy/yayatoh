'use client';

import { authClient } from '@yayatoh/auth/client';
import { buttonClass } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';

/** Sign out; `onDark` for the dark sidebar, otherwise the ghost button look for light pages. */
export function SignOutButton({ label, onDark = false }: { label: string; onDark?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/sign-in');
        router.refresh();
      }}
      className={
        onDark
          ? 'inline-flex min-h-9 items-center rounded-[12px] px-3 text-[13px] font-bold text-side-strong hover:bg-side-hover'
          : buttonClass('ghost', 'sm')
      }
    >
      {label}
    </button>
  );
}
