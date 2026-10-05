import { cx } from '@yayatoh/ui';

/** The Yayatoh mark: two leaves, pink and violet (ADR 0022). Decorative; the wordmark names it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={cx('size-[30px] shrink-0', className)}>
      <path d="M5 21C5 13.3 10.6 6 18.5 6c0 7.7-5.6 15-13.5 15z" className="fill-brand" />
      <path
        d="M27 11c0 7.7-5.6 15-13.5 15 0-7.7 5.6-15 13.5-15z"
        className="fill-primary"
        fillOpacity="0.92"
      />
    </svg>
  );
}
