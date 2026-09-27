'use client';

import { authClient } from '@yayatoh/auth/client';
import { Button } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/sign-in');
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
