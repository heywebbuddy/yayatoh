'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Copy one DNS value (U3). The value itself stays selectable text next to the button; the button
 * names what it copies for screen readers and says "Copied" in a live region.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useTranslations('domains.wizard');
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => undefined);
          setCopied(true);
        }}
      >
        {t('copy')}
        <span className="sr-only"> {label}</span>
      </Button>
      <span aria-live="polite" className="text-caption text-ink-2">
        {copied ? t('copied') : ''}
      </span>
    </span>
  );
}
