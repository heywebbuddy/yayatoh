import type { ReactNode } from 'react';

/**
 * The showcase frame of the sign-in, sign-up, password and two-factor pages: the dark surface with
 * a slow red glow behind the form. It only restyles: every field, error and step of these pages is
 * the page's own.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div data-surface="showcase" data-auth className="relative isolate min-h-dvh overflow-hidden bg-page">
      <div
        aria-hidden="true"
        className="animate-glow pointer-events-none absolute -top-40 left-1/2 -z-10 size-[620px] -translate-x-1/2 rounded-full bg-ember opacity-25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="animate-glow pointer-events-none absolute -bottom-52 -end-40 -z-10 size-[460px] rounded-full bg-rose opacity-20 blur-3xl"
      />
      {children}
    </div>
  );
}
