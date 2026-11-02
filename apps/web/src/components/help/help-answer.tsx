'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { HelpAnswerReply } from '@/app/[locale]/help/actions.ts';
import { Link } from '@/i18n/navigation.ts';

/**
 * AI1: an answer from the published articles, on request (a search never spends a credit by
 * itself). It says when the articles don't cover the question, and links what it rests on.
 */
export function HelpAnswer({
  question,
  ask,
}: {
  question: string;
  ask: (q: string) => Promise<HelpAnswerReply>;
}) {
  const t = useTranslations('aiPhase1.help');
  const [pending, start] = useTransition();
  const [reply, setReply] = useState<HelpAnswerReply | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line p-4" data-testid="help-answer">
      {!reply ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={pending}
          onClick={() => start(async () => setReply(await ask(question)))}
        >
          {pending ? t('working') : t('ask')}
        </Button>
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {reply?.kind === 'rate_limited' ? (
          <Alert title={t('rateLimited', { minutes: reply.minutes })} />
        ) : null}
        {reply?.kind === 'unavailable' ? <Alert tone="info" title={t('unavailable')} /> : null}
        {reply?.kind === 'answer' && !reply.known ? <p className="m-0 text-body">{t('unknown')}</p> : null}
        {reply?.kind === 'answer' && reply.known ? (
          <>
            <p className="m-0 text-body whitespace-pre-line break-words" data-testid="help-answer-text">
              {reply.answer}
            </p>
            <p className="m-0 text-caption text-ink-2">{t('sources')}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {reply.citations.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="text-body underline">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="m-0 text-caption text-ink-2">{t('disclosure')}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
