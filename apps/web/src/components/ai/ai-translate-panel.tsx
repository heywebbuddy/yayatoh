'use client';

import { Alert, Button, buttonClass, Select } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation.ts';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { useAiAction } from './use-ai-action.ts';

/** AI1: translate into a language; the result is a draft a person reviews, never published. */
export function AiTranslatePanel({
  locales,
  sourceLocale,
  run,
}: {
  locales: readonly string[];
  sourceLocale: string;
  run: (locale: string, overwrite: boolean) => Promise<AiComposeResult<{ href: string }>>;
}) {
  const t = useTranslations('aiPhase1.translate');
  const shown = useLocale();
  const options = locales.filter((l) => l !== sourceLocale);
  const [target, setTarget] = useState(options[0] ?? '');
  const [confirm, setConfirm] = useState<'exists' | 'published' | null>(null);
  const action = useAiAction<{ href: string }>();
  const go = (overwrite: boolean) => {
    setConfirm(null);
    action.run(
      () => run(target, overwrite),
      (reason) => {
        if (reason !== 'exists' && reason !== 'published') return false;
        setConfirm(reason);
        return true;
      },
    );
  };
  const names = new Intl.DisplayNames([shown], { type: 'language' });
  return (
    <div className="flex flex-col gap-3" data-testid="ai-translate">
      <h2 className="m-0 text-section">{t('title')}</h2>
      <p className="m-0 text-caption text-ink-2">{t('hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t('language')}
          value={target}
          onValueChange={(v) => {
            setTarget(v);
            setConfirm(null);
          }}
          options={options.map((l) => ({ value: l, label: names.of(l) ?? l }))}
        />
        <Button type="button" variant="secondary" disabled={action.pending} onClick={() => go(false)}>
          {action.pending ? t('working') : t('translate')}
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {action.problem ? <Alert title={action.problem} /> : null}
        {confirm === 'published' ? <Alert title={t('published')} /> : null}
        {confirm === 'exists' ? (
          <Alert tone="info" title={t('exists')}>
            <Button type="button" size="sm" variant="secondary" onClick={() => go(true)}>
              {t('overwrite')}
            </Button>
          </Alert>
        ) : null}
        {action.value && !confirm ? (
          <Alert tone="info" title={t('done')}>
            <Link href={action.value.href} className={buttonClass('secondary', 'sm')}>
              {t('open')}
            </Link>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
