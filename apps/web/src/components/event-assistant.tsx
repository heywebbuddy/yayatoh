'use client';

import { Alert, Button, cx } from '@yayatoh/ui';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition } from 'react';
import type { AssistantReply } from '@/app/[locale]/events/[slug]/assistant-actions.ts';
import { Link } from '@/i18n/navigation.ts';

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly reply: AssistantReply;
}

/**
 * The attendee assistant on the public event page and the ticket-holder pages: a question box
 * that answers from the event's own published details, shows what it used, and says plainly when
 * it cannot find the answer, then offers a person (the guest help request, which needs the ticket).
 * It is announced politely to screen readers and works with the keyboard alone.
 */
export function EventAssistant({
  slug,
  ask,
  helpHref,
}: {
  slug: string;
  ask: (slug: string, question: string) => Promise<AssistantReply>;
  /** Where "ask a person" goes: the seat finder, whose "Need help" button needs the ticket. */
  helpHref: string;
}) {
  const t = useTranslations('eventAssistant');
  const id = useId();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, start] = useTransition();
  const next = useRef(1);

  const submit = () => {
    const q = question.trim();
    if (q.length < 3 || pending) return;
    start(async () => {
      const reply = await ask(slug, q);
      setTurns((all) => [...all, { id: next.current++, question: q, reply }]);
      setQuestion('');
    });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-primary-ink"
        >
          <Sparkles className="size-5" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="m-0 text-section">
            {t('title')}
          </h2>
          <p className="m-0 text-body text-ink-2">{t('intro')}</p>
        </div>
      </div>

      <ol aria-live="polite" className="m-0 flex list-none flex-col gap-3 p-0">
        {turns.map((turn) => (
          <li key={turn.id} className="flex flex-col gap-2">
            <p className="m-0 self-end rounded-card bg-surface-3 px-3.5 py-2 text-body font-bold">
              {turn.question}
            </p>
            <Answer reply={turn.reply} helpHref={helpHref} />
          </li>
        ))}
      </ol>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`${id}-q`} className="sr-only">
          {t('question')}
        </label>
        <input
          id={`${id}-q`}
          className="field min-w-0 grow"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder={t('placeholder')}
          autoComplete="off"
        />
        <Button
          type="submit"
          disabled={pending || question.trim().length < 3}
          aria-busy={pending || undefined}
        >
          {pending ? t('thinking') : t('ask')}
        </Button>
      </form>
      <p className="m-0 text-caption text-ink-3">{t('disclaimer')}</p>
    </section>
  );
}

function Answer({ reply, helpHref }: { reply: AssistantReply; helpHref: string }) {
  const t = useTranslations('eventAssistant');
  const bubble = 'flex flex-col gap-2 rounded-card border border-line bg-surface-2 px-3.5 py-3';
  if (reply.kind === 'rate_limited')
    return <Alert tone="info" title={t('rateLimited', { minutes: reply.minutes })} />;
  if (reply.kind === 'off' || reply.kind === 'unavailable')
    return (
      <div className={bubble}>
        <p className="m-0 text-body">{reply.kind === 'off' ? t('off') : t('unavailable')}</p>
        <HumanHelp href={helpHref} />
      </div>
    );
  if (!reply.known)
    return (
      <div className={bubble}>
        <p className="m-0 text-body">{t('dontKnow')}</p>
        <HumanHelp href={helpHref} />
      </div>
    );
  return (
    <div className={bubble}>
      <p className="m-0 text-body whitespace-pre-line">{reply.answer}</p>
      {reply.citations.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-2">
          <span className="font-bold">{t('sources')}</span>
          {reply.citations.map((c) =>
            c.href ? (
              <a
                key={c.label}
                href={c.href}
                className={cx('rounded-pill bg-surface-3 px-2.5 py-0.5 underline')}
              >
                {c.label}
              </a>
            ) : (
              <span key={c.label} className="rounded-pill bg-surface-3 px-2.5 py-0.5">
                {c.label}
              </span>
            ),
          )}
        </p>
      ) : null}
    </div>
  );
}

function HumanHelp({ href }: { href: string }) {
  const t = useTranslations('eventAssistant');
  return (
    <p className="m-0 text-caption text-ink-2">
      {t('humanHelp')}{' '}
      <Link href={href} className="font-bold text-ink underline">
        {t('humanHelpLink')}
      </Link>
    </p>
  );
}
