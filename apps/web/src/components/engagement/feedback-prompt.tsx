'use client';

import { Alert, Button, buttonClass } from '@yayatoh/ui';
import { MessageSquareHeart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { LiveActionState } from '@/app/[locale]/events/[slug]/live/[session]/actions.ts';

const IDLE: LiveActionState = { ok: false, code: null };
/** The public pages' card (v2 public event page), as in the participant view. */
const CARD = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 elevation-card glass';

/**
 * The session-end feedback prompt (M5.7b) on the live session page: once the session is over and
 * it has a feedback survey, the signed-in attendee is asked for feedback (one response per
 * person); a visitor is asked to sign in; someone who answered is thanked.
 */
export function FeedbackPrompt({
  state,
  title,
  signInHref,
  open,
}: {
  state: 'sign_in' | 'open' | 'answered';
  title: string;
  signInHref: string;
  open: (prev: LiveActionState) => Promise<LiveActionState>;
}) {
  const t = useTranslations('engagement.feedback');
  const [result, action, pending] = useActionState(open, IDLE);
  const message =
    result.code === 'already_answered' || result.code === 'expired'
      ? t(`errors.${result.code}`)
      : t('errors.other');
  return (
    <section aria-labelledby="feedback-heading" className={CARD} data-testid="feedback-prompt">
      <h2 id="feedback-heading" className="m-0 flex items-center gap-2 text-section text-ink">
        <MessageSquareHeart aria-hidden="true" className="size-5 text-primary" />
        {t('heading')}
      </h2>
      <p className="m-0 text-body text-ink-2">{title}</p>
      {state === 'answered' ? (
        <p className="m-0 text-body font-semibold text-ink" role="status">
          {t('answered')}
        </p>
      ) : state === 'sign_in' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-body text-ink-2">{t('signInHint')}</p>
          <a href={signInHref} className={buttonClass('secondary', 'md', 'self-start')}>
            {t('signIn')}
          </a>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <Button type="submit" disabled={pending} className="self-start">
            {t('give')}
          </Button>
          <div aria-live="polite">{result.code ? <Alert title={message} /> : null}</div>
        </form>
      )}
    </section>
  );
}
