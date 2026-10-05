'use client';

import type { AudienceSuggestionDto } from '@yayatoh/ai';
import { Button, buttonClass } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { AiComposePanel } from '@/components/ai-compose-panel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { type AiComposeResult, type AiComposeSetup, encodeSuggestion } from '@/lib/ai-compose.ts';

export type AudienceSuggestion = AudienceSuggestionDto & { readonly count: number };

/**
 * M6.12b: "Suggest an audience". The organizer says who they want to reach; the suggestion is a
 * segment in the builder's own rules, with its size. They review it in the builder (where every
 * rule can be changed) and save it there: nothing is saved by AI.
 */
export function AudienceAiPanel({
  org,
  setup,
  suggest,
}: {
  org: string;
  setup: AiComposeSetup;
  suggest: (brief: string) => Promise<AiComposeResult<AudienceSuggestion>>;
}) {
  const t = useTranslations('audiences.ai');
  return (
    <AiComposePanel<AudienceSuggestion>
      setup={setup}
      voice={false}
      briefRequired
      run={(v) => suggest(v.brief)}
      briefLabel={t('brief')}
      briefHint={t('briefHint')}
      draftLabel={t('suggest')}
      renderPreview={(s, done) => (
        <div className="flex flex-col gap-2">
          <p className="text-body" data-testid="ai-audience-explanation">
            {s.explanation}
          </p>
          <p className="text-body font-bold" data-testid="ai-audience-count">
            {t('count', { count: s.count })}
          </p>
          <p className="text-caption text-ink-2">
            {t('rules', { count: s.definition.root.conditions.length })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/o/${org}/audiences/new?suggestion=${encodeSuggestion(s.definition)}`}
              className={buttonClass('primary')}
            >
              {t('review')}
            </Link>
            <Button type="button" variant="secondary" onClick={() => done(t('discarded'))}>
              {t('discard')}
            </Button>
          </div>
        </div>
      )}
    />
  );
}
