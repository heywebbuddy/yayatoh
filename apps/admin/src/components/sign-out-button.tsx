'use client';

import { authClient } from '@yayatoh/auth/client';
import { useRouter } from 'next/navigation';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/sign-in');
        router.refresh();
      }}
      className="inline-flex min-h-9 items-center rounded-[12px] px-3 text-[13px] font-bold text-side-strong hover:bg-side-hover"
    >
      {label}
    </button>
  );
}
