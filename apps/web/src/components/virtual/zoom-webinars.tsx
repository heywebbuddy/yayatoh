'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState } from 'react';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { Outcome } from './stream-setup.tsx';

type Act = (prev: typeof INITIAL_FORM_STATE) => Promise<typeof INITIAL_FORM_STATE>;

/**
 * M6.10a: create a session's Zoom webinar from Yayatoh (through the org's Zoom connection). One
 * button per session without a webinar; the success and refusals are announced next to it.
 */
export function CreateWebinarButton({
  title,
  linked,
  create,
}: {
  title: string;
  /** The session has a webinar now: no button, but the outcome stays announced. */
  linked: boolean;
  create: Act;
}) {
  const t = useTranslations('virtual.setup');
  const [state, action, pending] = useActionState(create, INITIAL_FORM_STATE);
  if (linked && !state.ok && !state.code) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {linked ? null : (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={t('createWebinarLabel', { title })}
            onClick={() => startTransition(() => action())}
          >
            {t('createWebinar')}
          </Button>
        </div>
      )}
      <Outcome state={state} saved={t('webinarCreated', { title })} />
    </div>
  );
}
