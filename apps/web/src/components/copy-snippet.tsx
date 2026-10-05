'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

/** A read-only code snippet with a copy button (the field itself is also selectable by keyboard). */
export function CopySnippet({ label, code }: { label: string; code: string }) {
  const t = useTranslations('site.widget');
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        readOnly
        rows={4}
        value={code}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="rounded-card border border-line bg-surface-2 px-4 py-3 font-mono text-caption"
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code).catch(() => undefined);
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
