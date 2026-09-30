'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { signOutEverywhereAction } from '@/server/session-actions.ts';

/**
 * "Sign out everywhere" (M1.2d): every session on every device and site ends. Asks first; the
 * confirmation takes focus, Escape or Cancel returns it.
 */
export function SignOutEverywhere() {
  const t = useTranslations('security');
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const promptId = useId();
  useEffect(() => {
    if (confirming) yes.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  if (!confirming)
    return (
      <Button ref={opener} variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
        {t('signOutEverywhere')}
      </Button>
    );
  return (
    <form
      action={signOutEverywhereAction}
      aria-labelledby={promptId}
      className="flex flex-col gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <p id={promptId} className="text-body">
        {t('confirmSignOutEverywhere')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button ref={yes} type="submit">
          {t('confirmSignOutEverywhereYes')}
        </Button>
        <Button variant="secondary" onClick={cancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
