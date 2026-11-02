import { buttonClass, cx } from '@yayatoh/ui';
import { ArrowRight } from 'lucide-react';
import type { CSSProperties } from 'react';

/**
 * The closing call to action of the event page: a wide band in the event's band colour (the
 * organizer's, contrast-checked) with the event name in the landing page's display type and the
 * main action at the end.
 */
export function EventLandingCta({
  name,
  when,
  label,
  heading,
  style,
}: {
  name: string;
  when: string;
  label: string;
  heading: string;
  style?: CSSProperties;
}) {
  return (
    <section
      aria-labelledby="cta-heading"
      style={style}
      className="ev-band relative isolate flex flex-col gap-6 overflow-hidden rounded-card px-6 py-10 md:flex-row md:items-end md:justify-between md:px-12 md:py-14"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-32 -z-10 size-[420px] rounded-full bg-white/10 blur-2xl"
      />
      <div className="flex max-w-[720px] flex-col gap-3">
        <p className="m-0 text-label font-extrabold tracking-[0.14em] uppercase opacity-85">{heading}</p>
        <h2
          id="cta-heading"
          className="m-0 font-display text-[length:calc(clamp(30px,4.6vw,52px)*var(--ev-scale,1))] leading-[0.98] font-black tracking-[-0.035em] text-balance uppercase"
        >
          {name}
        </h2>
        {when ? <p className="m-0 text-body font-bold opacity-90">{when}</p> : null}
      </div>
      <a href="#passes" className={cx(buttonClass('white', 'lg', 'shrink-0 self-start px-8 md:self-auto'))}>
        {label}
        <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" strokeWidth={2.6} />
      </a>
    </section>
  );
}
