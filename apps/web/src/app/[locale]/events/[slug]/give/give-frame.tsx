import { cx } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { ThemeSwitch } from '@/components/theme-switch.tsx';
import { currentTheme } from '@/server/theme.ts';

/** A public card on the giving pages, as on the v2 public event page (ADR 0022). */
export const giveCard =
  'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass';

/**
 * The giving pages' frame (ADR 0022, like the public event page), phone-first: a floating header
 * bar with the organizer and the theme switch, then one column.
 */
export async function GiveFrame({ organizer, children }: { organizer: string; children: ReactNode }) {
  const theme = await currentTheme();
  const initials = organizer
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pt-3 pb-12 sm:px-5 sm:pt-5">
      <header className="flex items-center gap-3 rounded-[22px] border border-line bg-surface p-2.5 ps-4 elevation-card glass">
        <span
          aria-hidden="true"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-brand-strong text-[13px] font-extrabold text-white"
        >
          {initials}
        </span>
        <span className="min-w-0 grow truncate text-[17px] font-extrabold tracking-[-0.02em] text-ink">
          {organizer}
        </span>
        <ThemeSwitch initial={theme} />
      </header>
      <main id="main" className="flex flex-col gap-5">
        {children}
      </main>
    </div>
  );
}

/** The violet hero with white text (a soft light in the top corner is decoration only). */
export function GiveHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'relative isolate flex flex-col gap-3 overflow-hidden rounded-[32px] bg-hero px-6 pt-10 pb-7 text-white elevation-card',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-12 -top-16 -z-10 size-56 rounded-full bg-white/20 blur-2xl"
      />
      {children}
    </section>
  );
}
