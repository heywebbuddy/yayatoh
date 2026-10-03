'use client';

import { Button, type ButtonSize, type ButtonVariant, cx } from '@yayatoh/ui';
import { useActionState } from 'react';

/** What a paddle-raise action answers: a localized sentence for the live region. */
export interface RaiseActionState {
  readonly ok: boolean | null;
  readonly message: string;
  readonly stamp: number;
}
export const INITIAL_RAISE_STATE: RaiseActionState = { ok: null, message: '', stamp: 0 };

/**
 * One console or recorder action as a form with a single button (M4.8c): works with the keyboard
 * and without JavaScript, and announces the server's answer ("Paddle 120 set aside.") politely.
 * Composed from `@yayatoh/ui` primitives; local to the paddle raise.
 */
export function RaiseActionButton({
  action,
  label,
  variant = 'secondary',
  size = 'md',
  className,
  testId,
}: {
  action: (prev: RaiseActionState, form: FormData) => Promise<RaiseActionState>;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_RAISE_STATE);
  return (
    <form action={formAction} className={cx('flex flex-col gap-1.5', className)} data-testid={testId}>
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {label}
      </Button>
      <p
        aria-live="polite"
        className={cx('m-0 text-caption', state.ok === false ? 'font-semibold text-danger' : 'text-ink-2')}
      >
        {pending ? '' : state.message}
      </p>
    </form>
  );
}
