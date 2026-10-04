'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * M6.12b: matchmaking for the organizer. Suggestions use AI embeddings of the profiles people
 * chose to show (opted in only); "Update suggestions" embeds the ones still waiting (one AI
 * credit per batch of up to 64 people). The outcome is announced in a live region.
 */
export function MatchmakingCard({
  listed,
  embedded,
  enabled,
  canWrite,
  refresh,
}: {
  listed: number;
  embedded: number;
  enabled: boolean;
  canWrite: boolean;
  refresh: () => Promise<AiComposeResult<{ embedded: number; pending: number }>>;
}) {
  const t = useTranslations('networking.matchmaking');
  const te = useTranslations();
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const waiting = Math.max(0, listed - embedded);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{t('explainer')}</p>
      <p className="text-body" data-testid="matchmaking-status">
        {t('status', { embedded, listed })}
      </p>
      {!enabled ? <Alert tone="info" title={t('unavailable')} /> : null}
      {canWrite && enabled ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || waiting === 0}
            aria-busy={pending || undefined}
            onClick={() =>
              start(async () => {
                const res = await refresh();
                if (res.ok && res.value)
                  setMessage({
                    tone: 'info',
                    text:
                      res.value.pending > 0
                        ? t('donePartial', { count: res.value.embedded, pending: res.value.pending })
                        : t('done', { count: res.value.embedded }),
                  });
                else
                  setMessage({
                    tone: 'danger',
                    text:
                      res.code === 'rate_limited'
                        ? te('aiCompose.rateLimited', { minutes: res.retryMinutes ?? 1 })
                        : res.reason === 'out_of_credits'
                          ? te('aiCompose.outOfCredits')
                          : res.reason === 'ai_unavailable' || res.reason === 'ai_output'
                            ? te(`aiCompose.errors.${res.reason}`)
                            : te(errorMessageKey(res.code)),
                  });
              })
            }
          >
            {waiting === 0 ? t('upToDate') : t('refresh', { count: waiting })}
          </Button>
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {message ? (
          message.tone === 'info' ? (
            <p className="text-body font-medium">{message.text}</p>
          ) : (
            <Alert title={message.text} />
          )
        ) : null}
      </div>
    </div>
  );
}
