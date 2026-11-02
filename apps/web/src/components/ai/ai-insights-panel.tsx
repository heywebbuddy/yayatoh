'use client';

import type { InsightResultDto, SummarizeResultDto } from '@yayatoh/ai';
import { Alert, Button, Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { useAiAction } from './use-ai-action.ts';

export interface InsightView {
  readonly result: InsightResultDto;
  readonly basedOn: number;
  readonly total: number;
  /** Answers changed since this summary was made. */
  readonly stale: boolean;
}

/**
 * AI1: a summary of an event's reviews or a survey's answers. Quotes are the answers' own words.
 * Those who may read the answers see a saved summary; `run` is absent for those who may not make
 * one. Pressing it again with unchanged answers spends nothing.
 */
export function AiInsightsPanel({
  saved,
  run,
  answers,
}: {
  saved: InsightView | null;
  run?: () => Promise<AiComposeResult<SummarizeResultDto>>;
  /** Written answers to read right now. */
  answers: number;
}) {
  const t = useTranslations('aiPhase1.insights');
  const action = useAiAction<SummarizeResultDto>();
  const view: InsightView | null = action.value
    ? {
        result: action.value.result,
        basedOn: action.value.basedOn,
        total: action.value.total,
        stale: false,
      }
    : saved;
  if (!view && (!run || answers === 0)) return null;
  return (
    <Card className="flex flex-col gap-3" data-testid="ai-insights">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-section">{t('title')}</h2>
        {run && answers > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={action.pending}
            onClick={() => action.run(run)}
          >
            {action.pending ? t('working') : view ? t('refresh') : t('summarize')}
          </Button>
        ) : null}
      </div>
      <div aria-live="polite">
        {action.problem ? <Alert title={action.problem} /> : null}
        {action.value?.cached ? <p className="m-0 text-caption text-ink-2">{t('unchanged')}</p> : null}
      </div>
      {view ? (
        <>
          <p className="m-0 text-body" data-testid="ai-insights-summary">
            {view.result.summary}
          </p>
          <p className="m-0 text-caption text-ink-2">
            {t(`sentiment.${view.result.sentiment}`)} ·{' '}
            {view.basedOn < view.total
              ? t('basedOnNewest', { count: view.basedOn, total: view.total })
              : t('basedOn', { count: view.basedOn })}
          </p>
          {view.stale ? <p className="m-0 text-caption text-ink-2">{t('stale')}</p> : null}
          {view.result.themes.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {view.result.themes.map((theme) => (
                <li key={theme.title} className="flex flex-col gap-1">
                  <span className="text-body font-bold">
                    {theme.title} · {t('mentions', { count: theme.mentions })}
                  </span>
                  {theme.quotes.map((q) => (
                    <blockquote
                      key={q}
                      className="m-0 border-s-2 border-line ps-3 text-caption break-words text-ink-2"
                    >
                      {q}
                    </blockquote>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="m-0 text-caption text-ink-2">{t('disclosure')}</p>
        </>
      ) : (
        <p className="m-0 text-caption text-ink-2">{t('hint')}</p>
      )}
    </Card>
  );
}
