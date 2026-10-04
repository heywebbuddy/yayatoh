'use client';

import { Button, buttonClass, Input } from '@yayatoh/ui';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * The screen's signed link (M4.8d): a read-only field (selectable with the keyboard), Copy, and
 * links that open the screen as it is, in high contrast or with reduced motion.
 */
export function ScreenLink({ url }: { url: string }) {
  const t = useTranslations('donations.screenPage');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Input
        id="screen-link"
        label={t('linkLabel')}
        readOnly
        value={url}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono"
      />
      <div className="flex flex-wrap items-center gap-2">
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
        </Button>
        <a href={url} target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')}>
          <ExternalLink aria-hidden="true" className="size-4" />
          {t('openScreen')}
        </a>
        <a
          href={`${url}?contrast=high`}
          target="_blank"
          rel="noopener"
          className={buttonClass('ghost', 'sm')}
        >
          {t('openContrast')}
        </a>
        <a
          href={`${url}?motion=reduced`}
          target="_blank"
          rel="noopener"
          className={buttonClass('ghost', 'sm')}
        >
          {t('openStill')}
        </a>
        <span aria-live="polite" className="text-caption text-ink-2">
          {copied ? t('copied') : ''}
        </span>
      </div>
    </div>
  );
}
