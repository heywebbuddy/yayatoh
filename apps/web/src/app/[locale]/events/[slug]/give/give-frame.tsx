import { cx } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { EventSubpageFrame } from '@/components/event-subpage-frame.tsx';

/** A public card on the giving pages, as on the v2 public event page (ADR 0022). */
export const giveCard = 'ev-card flex flex-col gap-4 rounded-card p-5 md:p-7';

/**
 * The giving pages' frame: the event sub-page frame (site top bar and footer, the organizer's page
 * design, a way back to the event), phone-first in one column.
 */
export async function GiveFrame({
  slug,
  children,
}: {
  slug: string;
  organizer?: string;
  children: ReactNode;
}) {
  return (
    <EventSubpageFrame slug={slug} width="max-w-xl">
      {children}
    </EventSubpageFrame>
  );
}

/** The violet hero with white text (a soft light in the top corner is decoration only). */
export function GiveHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'relative isolate flex flex-col gap-3 overflow-hidden rounded-card bg-hero px-6 pt-10 pb-7 text-white elevation-card',
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
