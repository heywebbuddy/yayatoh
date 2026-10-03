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
  disabled,
  create,
}: {
  title: string;
  disabled: boolean;
  create: Act;
}) {
  const t = useTranslations('virtual.setup');
  const [state, action, pending] = useActionState(create, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || disabled}
          aria-label={t('createWebinarLabel', { title })}
          onClick={() => startTransition(() => action())}
        >
          {t('createWebinar')}
        </Button>
      </div>
      <Outcome state={state} saved={t('webinarCreated', { title })} />
    </div>
  );
}
