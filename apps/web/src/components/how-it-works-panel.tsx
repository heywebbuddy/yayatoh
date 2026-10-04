'use client';

import { cx } from '@yayatoh/ui';
import { BookOpen, ChevronDown, Lightbulb } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { HELP_COOKIE, type HelpTopic, parseClosedHelp, serializeClosedHelp } from '@/lib/help-topics.ts';

function remember(topic: HelpTopic, open: boolean) {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${HELP_COOKIE}=`))
    ?.slice(HELP_COOKIE.length + 1);
  const closed = parseClosedHelp(raw ? decodeURIComponent(raw) : undefined);
  if (open) closed.delete(topic);
  else closed.add(topic);
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie (no secrets), read on the server.
  document.cookie = `${HELP_COOKIE}=${serializeClosedHelp(closed)}; path=/; max-age=31536000; samesite=lax`;
}

/** The disclosure behind `HowItWorks` (a native <details>, keyboard and screen-reader ready). */
export function HowItWorksPanel({
  topic,
  id,
  initiallyOpen,
  title,
  intro,
  steps,
  docLabel,
  docHref,
  hideLabel,
  showLabel,
}: {
  topic: HelpTopic;
  /** An anchor (e.g. the Create menu's `#new-template`); arriving on it opens the panel. */
  id?: string;
  initiallyOpen: boolean;
  title: string;
  intro: string;
  steps: readonly string[];
  docLabel: string;
  docHref: string;
  hideLabel: string;
  showLabel: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    if (id && window.location.hash === `#${id}`) setOpen(true);
  }, [id]);
  return (
    <details
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setOpen(now);
        remember(topic, now);
      }}
      id={id}
      data-help-topic={topic}
      className="group/help scroll-mt-6 rounded-card border border-line bg-surface glass"
    >
      <summary
        className={cx(
          'flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-card px-5 py-3 [&::-webkit-details-marker]:hidden',
          'hover:bg-surface-2',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-tag bg-primary-soft text-primary-ink"
        >
          <Lightbulb className="size-[18px]" strokeWidth={2} />
        </span>
        <span className="grow text-card text-ink">{title}</span>
        {/* The disclosure state is announced already; the word is for sighted users. */}
        <span aria-hidden="true" className="text-caption font-semibold text-ink-2">
          {open ? hideLabel : showLabel}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-2 transition-transform duration-150 group-open/help:rotate-180 motion-reduce:transition-none"
          strokeWidth={2}
        />
      </summary>
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
        <p className="m-0 max-w-[75ch] text-body text-ink-2">{intro}</p>
        <ol
          className={cx(
            'm-0 grid list-none gap-3 p-0',
            steps.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3',
          )}
        >
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3 rounded-tile bg-surface-2 p-3.5">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary text-caption font-extrabold text-on-primary"
              >
                {i + 1}
              </span>
              <span className="text-body text-ink">{s}</span>
            </li>
          ))}
        </ol>
        <Link
          href={docHref}
          className="inline-flex min-h-6 items-center gap-2 self-start rounded-tag text-body font-bold text-primary-ink underline underline-offset-2"
        >
          <BookOpen aria-hidden="true" className="size-4" strokeWidth={2} />
          {docLabel}
        </Link>
      </div>
    </details>
  );
}
