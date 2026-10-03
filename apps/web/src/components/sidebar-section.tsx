'use client';

import { cx } from '@yayatoh/ui';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { usePathname } from '@/i18n/navigation.ts';
import {
  NAV_COOKIE,
  type OrgSectionKey,
  parseClosedSections,
  serializeClosedSections,
} from '@/lib/org-nav.ts';

function readClosed(): Set<OrgSectionKey> {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${NAV_COOKIE}=`))
    ?.slice(NAV_COOKIE.length + 1);
  return parseClosedSections(raw ? decodeURIComponent(raw) : undefined);
}

function remember(section: OrgSectionKey, open: boolean) {
  const closed = readClosed();
  if (open) closed.delete(section);
  else closed.add(section);
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie (no secrets), read on the server.
  document.cookie = `${NAV_COOKIE}=${serializeClosedSections(closed)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * U2: one collapsible sidebar section (Events, Audience & marketing, Money, Site & content,
 * Settings). A native disclosure, so it works by keyboard and before hydration. The member's
 * open/closed choice is remembered (a cookie the server reads, so the sidebar renders as they left
 * it); the section that holds the current page always opens.
 */
export function SidebarSection({
  section,
  label,
  closed,
  paths,
  children,
}: {
  section: OrgSectionKey;
  label: string;
  /** Closed in the member's saved preference. */
  closed: boolean;
  /** The section's item hrefs: the current page among them keeps the section open. */
  paths: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const holdsCurrent = paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [open, setOpen] = useState(!closed || holdsCurrent);
  const id = `nav-section-${section}`;
  return (
    <details
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setOpen(now);
        remember(section, now);
      }}
      className="group/section flex flex-col"
      data-nav-section={section}
    >
      <summary
        id={id}
        className={cx(
          'flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-tag px-2.5 py-1 text-label tracking-[0.12em] text-side-label uppercase',
          'hover:text-side-strong [&::-webkit-details-marker]:hidden',
        )}
      >
        <span className="grow">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-150 group-open/section:rotate-180 motion-reduce:transition-none"
          strokeWidth={2}
        />
      </summary>
      <div className="flex flex-col gap-1 pt-1">{children}</div>
    </details>
  );
}
