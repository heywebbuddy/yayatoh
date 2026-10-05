import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { AVATAR_TONES, type AvatarTone } from '../tokens.ts';

/** Stable pastel for a name: the same person always gets the same colour. */
export function avatarTone(seed: string): AvatarTone {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length] as AvatarTone;
}

const TONE: Record<AvatarTone, string> = {
  lavender: 'bg-lavender',
  blush: 'bg-blush',
  sky: 'bg-sky',
  sand: 'bg-sand',
  mint: 'bg-mint',
};

/** Avatar sizes as static classes: the strict CSP allows no style attributes (M1.14a). */
const SIZE = {
  24: 'size-6 text-[10px]',
  28: 'size-7 text-[11px]',
  30: 'size-[30px] text-[11px]',
  34: 'size-[34px] text-caption',
  38: 'size-[38px] text-caption',
  42: 'size-[42px] text-[13px]',
  48: 'size-12 text-body',
} as const;
export type AvatarSize = keyof typeof SIZE;

/**
 * Initials on a pastel picked by a stable hash of the name. `label` is the accessible name; pass
 * `decorative` when the name is already written next to it.
 */
export function Avatar({
  initials,
  label,
  size = 30,
  tone,
  decorative = false,
  className,
}: {
  initials: string;
  label: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-avatar-ink select-none',
        TONE[tone ?? avatarTone(label)],
        SIZE[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** Overlapping avatars (a party, a team) with a "+n" for the rest. */
export function AvatarStack({
  people,
  max = 3,
  size = 38,
  label,
  more,
}: {
  people: readonly { initials: string; name: string }[];
  max?: number;
  size?: AvatarSize;
  /** The group's accessible name, e.g. "The Okafor family: 4 guests". */
  label: string;
  /** Text for the overflow bubble, e.g. "+2". */
  more?: (n: number) => string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0">
      {shown.map((p, i) => (
        <Avatar
          // biome-ignore lint/suspicious/noArrayIndexKey: two guests can share a name; the order is fixed
          key={`${p.name}-${i}`}
          initials={p.initials}
          label={p.name}
          size={size}
          decorative
          className={cx('ring-2 ring-surface-solid', i > 0 && '-ms-3')}
        />
      ))}
      {rest > 0 ? (
        <span
          aria-hidden="true"
          className={cx(
            '-ms-3 inline-flex items-center justify-center rounded-full bg-surface-3 font-extrabold text-ink-2 ring-2 ring-surface-solid',
            SIZE[size],
          )}
        >
          {more ? more(rest) : `+${rest}`}
        </span>
      ) : null}
    </span>
  );
}

/** A check mark in a mint disc (checked in, accepted). */
export function CheckDisc({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        'inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-success-dot text-black ring-4 ring-success-soft',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[13px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * Name chip: pill with avatar, name, a detail line (role) and an optional end slot (a mint check when `checked`).
 */
export function PersonChip({
  name,
  initials,
  detail,
  checked,
  checkLabel,
  end,
  className,
}: {
  name: string;
  initials: string;
  detail?: ReactNode;
  /** Shows the mint check (needs `checkLabel`, e.g. "Checked in"). */
  checked?: boolean;
  checkLabel?: string;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex max-w-[340px] min-w-0 items-center gap-2.5 rounded-pill border border-line bg-surface-solid/60 p-1.5 pe-2',
        className,
      )}
    >
      <Avatar initials={initials} label={name} size={34} decorative />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-body font-bold text-ink">{name}</span>
        {detail ? <span className="truncate text-caption text-ink-2">{detail}</span> : null}
      </div>
      {checked && checkLabel ? <CheckDisc label={checkLabel} /> : end}
    </div>
  );
}
