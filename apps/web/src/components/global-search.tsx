'use client';

import { SearchPill } from '@yayatoh/ui';
import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';

/**
 * The console's search field: ⌘K / Ctrl+K (or "/" outside a text field) focuses it, and Enter
 * opens org-wide results for attendees, orders and ticket codes.
 */
export function GlobalSearch({
  org,
  label,
  placeholder,
  defaultValue,
}: {
  org: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
}) {
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <search className="order-last w-full sm:order-none sm:w-[300px]">
      <form action={`${locale === 'en' ? '' : `/${locale}`}/o/${org}/search`}>
        <SearchPill
          ref={input}
          name="q"
          required
          minLength={2}
          maxLength={200}
          defaultValue={defaultValue}
          label={label}
          placeholder={placeholder}
          shortcut="⌘K"
          aria-keyshortcuts="Control+K Meta+K /"
        />
      </form>
    </search>
  );
}
