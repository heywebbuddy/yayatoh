'use client';

import type { SupportAssistResultDto } from '@yayatoh/ai';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { useAiAction } from './use-ai-action.ts';

/**
 * AI1: labels for a customer request and a draft answer. "Use this draft" only fills the staff
 * member's own box (`targetId`): nothing is sent, decided or saved here.
 */
export function AiAssistPanel({
  run,
  targetId,
  mode,
}: {
  run: () => Promise<AiComposeResult<SupportAssistResultDto>>;
  targetId: string;
  mode: 'reply' | 'decline';
}) {
  const t = useTranslations('aiPhase1.assist');
  const action = useAiAction<SupportAssistResultDto>();
  const [used, setUsed] = useState(false);
  const r = action.value;
  const use = () => {
    if (!r) return;
    const box = document.getElementById(targetId);
    if (!(box instanceof HTMLTextAreaElement)) return;
    box.value = r.draft.slice(0, box.maxLength > 0 ? box.maxLength : r.draft.length);
    box.focus();
    setUsed(true);
  };
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line p-3" data-testid="ai-assist">
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={action.pending}
          onClick={() => {
            setUsed(false);
            action.run(run);
          }}
        >
          {action.pending ? t('working') : t(mode === 'reply' ? 'suggestReply' : 'suggestDecline')}
        </Button>
      </div>
      <div aria-live="polite">
        {action.problem ? <Alert title={action.problem} /> : null}
        {r ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-caption text-ink-2">
              {t(`category.${r.category}`)} · {t(`urgency.${r.urgency}`)}
            </p>
            {r.summary ? <p className="m-0 text-body">{r.summary}</p> : null}
            <p
              className="m-0 rounded-card bg-surface-2 p-3 text-body whitespace-pre-line break-words"
              data-testid="ai-assist-draft"
            >
              {r.draft}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" onClick={use}>
                {t('useDraft')}
              </Button>
              {used ? <span className="text-caption text-ink-2">{t('used')}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
      <p className="m-0 text-caption text-ink-2">{t('disclosure')}</p>
    </div>
  );
}
