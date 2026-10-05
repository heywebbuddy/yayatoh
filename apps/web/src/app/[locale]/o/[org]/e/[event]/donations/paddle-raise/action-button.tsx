'use client';

import { Alert, Button, type ButtonSize, type ButtonVariant, cx } from '@yayatoh/ui';
import { createContext, type ReactNode, useActionState, useContext, useState } from 'react';

/** What a paddle-raise action answers: a localized sentence for the live region. */
export interface RaiseActionState {
  readonly ok: boolean | null;
  readonly message: string;
  readonly stamp: number;
}
export const INITIAL_RAISE_STATE: RaiseActionState = { ok: null, message: '', stamp: 0 };

const Announce = createContext<((s: RaiseActionState) => void) | null>(null);

/**
 * The page's answer line (M4.8c): an action's button often disappears once it worked (calling a
 * level swaps the level buttons for Close; confirming the last paddle removes the confirm
 * button), so the answer is shown here, above the controls, and announced politely.
 */
export function RaiseAnnouncer({ children }: { children: ReactNode }) {
  const [last, setLast] = useState<RaiseActionState | null>(null);
  return (
    <Announce.Provider value={setLast}>
      <div data-testid="raise-answer">
        {last?.message ? (
          <Alert key={last.stamp} tone={last.ok ? 'success' : 'danger'} title={last.message} />
        ) : null}
      </div>
      {children}
    </Announce.Provider>
  );
}

/**
 * One console or recorder action as a form with a single button (M4.8c): works with the keyboard
 * and without JavaScript, and hands the server's answer ("Paddle 120 set aside.") to the page's
 * announcer (or shows it under the button when there is none). Composed from `@yayatoh/ui`
 * primitives; local to the paddle raise.
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
  const announce = useContext(Announce);
  // Announced from the action itself: when it worked, the server's new page may remove this
  // button in the same update, so an effect here would never run.
  const [state, formAction, pending] = useActionState(async (prev: RaiseActionState, form: FormData) => {
    const next = await action(prev, form);
    announce?.(next);
    return next;
  }, INITIAL_RAISE_STATE);
  return (
    <form action={formAction} className={cx('flex flex-col gap-1.5', className)} data-testid={testId}>
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {label}
      </Button>
      {announce ? null : (
        <p
          aria-live="polite"
          className={cx('m-0 text-caption', state.ok === false ? 'font-semibold text-danger' : 'text-ink-2')}
        >
          {pending ? '' : state.message}
        </p>
      )}
    </form>
  );
}
