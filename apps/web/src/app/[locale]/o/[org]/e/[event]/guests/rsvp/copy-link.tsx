'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

/** A party's RSVP link: a read-only field (selectable by keyboard) and a copy button (M4.1d). */
export function CopyLink({ label, url }: { label: string; url: string }) {
  const t = useTranslations('rsvpHost');
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-caption text-ink-2">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={url}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-10 w-full rounded-pill border border-line bg-surface-2 px-4 font-mono text-caption"
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          {t('copy')}
          <span className="sr-only"> {label}</span>
        </Button>
        <span aria-live="polite" className="text-caption text-ink-2">
          {copied ? t('copied') : ''}
        </span>
      </div>
    </div>
  );
}
