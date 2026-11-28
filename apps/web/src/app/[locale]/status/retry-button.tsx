'use client';

import { Button } from '@yayatoh/ui';
import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation.ts';

/** Asks the status provider again (re-renders the page on the server) when it couldn't be read. */
export function RetryButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button loading={pending} onClick={() => start(() => router.refresh())}>
      {label}
    </Button>
  );
}
