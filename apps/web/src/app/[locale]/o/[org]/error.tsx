'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '@/lib/errors.ts';

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16">
      <Alert title={t(errorMessageKey(error.code))}>
        {error.digest ? t('errors.reference', { id: error.digest }) : null}
      </Alert>
      <Button variant="secondary" onClick={reset} className="self-start">
        {t('actions.tryAgain')}
      </Button>
    </main>
  );
}
