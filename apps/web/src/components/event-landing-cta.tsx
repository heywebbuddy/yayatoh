import { buttonClass, cx } from '@yayatoh/ui';
import type { CSSProperties } from 'react';

/** The closing call-to-action band of the event page: a bold colour band with the main action. */
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
      className="ev-band relative isolate flex flex-col items-center gap-4 overflow-hidden rounded-[28px] px-6 py-12 text-center md:py-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-24 -z-10 size-80 rounded-full bg-white/12"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -start-20 -bottom-28 -z-10 size-96 rotate-12 rounded-[96px] bg-black/10"
      />
      <p className="m-0 text-label font-bold tracking-[0.12em] uppercase">{heading}</p>
      <h2
        id="cta-heading"
        className="m-0 max-w-[760px] text-[length:calc(40px*var(--ev-scale,1))] leading-[1.05] font-extrabold tracking-[-0.03em]"
      >
        {name}
      </h2>
      {when ? <p className="m-0 text-body font-bold">{when}</p> : null}
      <a href="#passes" className={cx(buttonClass('inverse', 'lg'), 'ev-white-card mt-2 hover:opacity-90')}>
        {label}
      </a>
    </section>
  );
}
