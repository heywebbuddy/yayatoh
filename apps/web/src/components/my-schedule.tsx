'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

/** What one session's form returns (M5.2b "My schedule"). */
export interface ScheduleActionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** The session standing in the way (overlap, pick-one group). */
  readonly otherTitle?: string;
  readonly groupName?: string;
  /** P5-9: both overlapping sessions are uncapped, so "keep both" is allowed. */
  readonly keepBoth?: boolean;
  /** What happened: enrolled, waiting, offered, dropped, left, declined, accepted. */
  readonly done?: string;
  readonly position?: number;
  readonly stamp?: number;
}

const INITIAL: ScheduleActionState = { ok: false, code: null };

type Action = (prev: ScheduleActionState, form: FormData) => Promise<ScheduleActionState>;

/**
 * One session's actions on the attendee's schedule: enrol or join the line, drop or leave it,
 * accept or decline an offer. A refused enrollment says why; an overlap or a pick-one group offers
 * "Replace" (and "Keep both" when allowed). Feedback is announced politely and stays after the
 * page refreshes. Buttons are 48 px (phone-first).
 */
export function ScheduleSessionActions({
  action,
  title,
  state,
}: {
  action: Action;
  title: string;
  state:
    | 'included'
    | 'enrolled'
    | 'offered'
    | 'waiting'
    | 'open'
    | 'full'
    | 'waitlist_closed'
    | 'closed'
    | 'started';
}) {
  const t = useTranslations('mySchedule');
  const te = useTranslations();
  const [result, formAction, pending] = useActionState(action, INITIAL);
  const done = result.ok && result.done ? result.done : null;
  const conflict = !result.ok && (result.reason === 'overlap' || result.reason === 'one_per_group');
  const refusal = !result.ok && result.code && !conflict;
  const refusalText = () => {
    const key = `refused.${result.reason}`;
    if (result.reason && t.has(key))
      return t(key as 'refused.closed', { title, other: result.otherTitle ?? '' });
    return te(errorMessageKey(result.code));
  };
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {state === 'open' ? (
          <Button type="submit" size="lg" disabled={pending} aria-label={t('enrolNamed', { title })}>
            {t('enrol')}
          </Button>
        ) : null}
        {state === 'full' ? (
          <Button type="submit" size="lg" disabled={pending} aria-label={t('joinNamed', { title })}>
            {t('join')}
          </Button>
        ) : null}
        {state === 'offered' ? (
          <>
            <Button
              type="submit"
              size="lg"
              name="intent"
              value="accept"
              disabled={pending}
              aria-label={t('acceptNamed', { title })}
            >
              {t('accept')}
            </Button>
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              name="intent"
              value="drop"
              disabled={pending}
              aria-label={t('declineNamed', { title })}
            >
              {t('decline')}
            </Button>
          </>
        ) : null}
        {state === 'enrolled' ? (
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            name="intent"
            value="drop"
            disabled={pending}
            aria-label={t('dropNamed', { title })}
          >
            {t('drop')}
          </Button>
        ) : null}
        {state === 'waiting' ? (
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            name="intent"
            value="drop"
            disabled={pending}
            aria-label={t('leaveNamed', { title })}
          >
            {t('leave')}
          </Button>
        ) : null}
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {done ? (
          <Alert
            tone={done === 'dropped' || done === 'left' || done === 'declined' ? 'info' : 'success'}
            title={t(`done.${done}` as 'done.enrolled', { title, position: result.position ?? 0 })}
          />
        ) : null}
        {refusal ? <Alert title={refusalText()} /> : null}
        {conflict ? (
          <div className="flex flex-col gap-3">
            <Alert
              tone="warning"
              title={
                result.reason === 'one_per_group'
                  ? t('conflict.group', {
                      title,
                      other: result.otherTitle ?? '',
                      group: result.groupName ?? '',
                    })
                  : t('conflict.overlap', { title, other: result.otherTitle ?? '' })
              }
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" name="choice" value="replace" disabled={pending}>
                {t('replace', { other: result.otherTitle ?? '' })}
              </Button>
              {result.keepBoth ? (
                <Button
                  type="submit"
                  size="lg"
                  variant="secondary"
                  name="choice"
                  value="keep_both"
                  disabled={pending}
                >
                  {t('keepBoth')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
