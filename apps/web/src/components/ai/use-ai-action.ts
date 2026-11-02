'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Run one AI action: its pending state, its value, and its failure in the buyer's words. */
export function useAiAction<T>() {
  const t = useTranslations('aiCompose');
  const tp = useTranslations('aiPhase1');
  const te = useTranslations();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<T | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (call: () => Promise<AiComposeResult<T>>, onReason?: (reason: string) => boolean) =>
    start(async () => {
      setProblem(null);
      const res = await call();
      if (res.ok && res.value !== undefined) {
        setValue(res.value);
        return;
      }
      if (res.reason && onReason?.(res.reason)) return;
      setProblem(
        res.code === 'rate_limited'
          ? t('rateLimited', { minutes: res.retryMinutes ?? 1 })
          : res.reason === 'out_of_credits'
            ? t('outOfCredits')
            : res.reason === 'ai_unavailable' || res.reason === 'ai_output'
              ? t(`errors.${res.reason}`)
              : res.reason === 'too_long'
                ? tp('translate.tooLong')
                : res.reason === 'incomplete'
                  ? tp('translate.incomplete')
                  : te(errorMessageKey(res.code)),
      );
    });
  return { pending, value, problem, run };
}
