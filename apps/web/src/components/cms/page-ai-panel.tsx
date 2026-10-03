'use client';

import type { PageDraftDto } from '@yayatoh/ai';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { AiComposePanel } from '@/components/ai-compose-panel.tsx';
import type { AiComposeResult, AiComposeSetup, AiComposeValues } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FormState } from '@/lib/form-state.ts';

/**
 * M6.12b: "Draft with AI" for a site page or post. The preview becomes a new **draft** entry the
 * organizer then edits and publishes as usual; it is never published by AI.
 */
export function PageAiPanel({
  setup,
  draft,
  create,
}: {
  setup: AiComposeSetup;
  draft: (values: AiComposeValues) => Promise<AiComposeResult<PageDraftDto>>;
  create: (draft: PageDraftDto) => Promise<FormState>;
}) {
  const t = useTranslations('cms.ai');
  const te = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <AiComposePanel<PageDraftDto>
      setup={setup}
      run={draft}
      briefLabel={t('brief')}
      renderPreview={(d, done) => (
        <div className="flex flex-col gap-2">
          <p className="text-body font-bold" data-testid="ai-page-title">
            {d.title}
          </p>
          {d.excerpt ? <p className="text-caption text-ink-2">{d.excerpt}</p> : null}
          <p className="whitespace-pre-line text-body" data-testid="ai-page-body">
            {d.body}
          </p>
          {error ? <Alert title={error} /> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await create(d);
                  if (res && !res.ok) setError(te(errorMessageKey(res.code)));
                })
              }
            >
              {t('create')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => done(t('discarded'))}>
              {t('discard')}
            </Button>
          </div>
        </div>
      )}
    />
  );
}
