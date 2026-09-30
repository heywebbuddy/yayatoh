import { cx } from '../cx.ts';
import type { Status } from '../tokens.ts';

const DOT: Record<Status, string> = {
  success: 'bg-green-500',
  warning: 'bg-accent-700',
  danger: 'bg-pink-700',
  info: 'bg-zinc-400',
  neutral: 'bg-zinc-300',
};

/** Status as a small coloured dot plus text — never a filled badge (ADR 0018). */
export function StatusDot({
  status,
  label,
  live = false,
}: {
  status: Status;
  label: string;
  live?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-caption text-zinc-700" data-status={status}>
      <span
        aria-hidden="true"
        className={cx('size-1.5 shrink-0 rounded-full', DOT[status], live && 'animate-pulse')}
      />
      {label}
    </span>
  );
}
