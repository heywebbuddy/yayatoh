'use client';

import { buttonClass, cx, Menu } from '@yayatoh/ui';
import { Plus } from 'lucide-react';
import { Link } from '@/i18n/navigation.ts';
import { Icon } from './icons.tsx';

export interface CreateEntry {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

/**
 * U2: the top bar's global Create menu (event, series, template, venue, coupon, page or blog
 * post). The shell passes only the entries this member may create (permissions and entitlements);
 * it is a WAI-ARIA menu button, so it works by keyboard.
 */
export function CreateMenu({ label, entries }: { label: string; entries: readonly CreateEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Menu
      label={label}
      testId="create-menu"
      link={Link}
      align="end"
      triggerClassName={cx(buttonClass('primary', 'md'), 'max-sm:px-3')}
      trigger={
        <>
          <Plus aria-hidden="true" strokeWidth={2.4} />
          <span className="max-sm:sr-only">{label}</span>
        </>
      }
      items={entries.map((e) => ({
        key: e.key,
        label: e.label,
        href: e.href,
        icon: <Icon name={e.icon} className="size-[18px]" />,
      }))}
    />
  );
}
