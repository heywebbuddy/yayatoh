import { type FormEvent, startTransition } from 'react';

/**
 * Submit a `useActionState` form without React's automatic form reset, so a rejected submit keeps
 * what the person typed (the server's field errors point at it). Forms that should clear after a
 * success reset themselves when the state says `ok`. Without JavaScript the `action` prop still
 * posts the form.
 */
export function keepValues(dispatch: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(e.currentTarget, submitter instanceof HTMLElement ? submitter : undefined);
    startTransition(() => dispatch(form));
  };
}
