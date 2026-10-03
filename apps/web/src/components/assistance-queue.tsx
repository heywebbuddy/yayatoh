'use client';

import { Alert, Button, StatusDot } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { AssistanceActionState } from '@/app/[locale]/o/[org]/e/[event]/assistance/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useRealtime } from '@/lib/use-realtime.ts';

const EVENTS = ['request'] as const;
const DOT = { live: 'success', connecting: 'warning', offline: 'neutral' } as const;

/**
 * The queue follows the event's assistance channel (M3.3b): a request raised, taken or closed
 * anywhere (the seat finder, a scanner, another organizer) re-reads the page within a moment.
 */
export function AssistanceLive({ url }: { url: string }) {
  const t = useTranslations('assistance.live');
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const state = useRealtime(url, EVENTS, {
    request: () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 250);
    },
  });
  return (
    <div data-testid="assistance-live" data-live={state}>
      <StatusDot status={DOT[state]} label={t(state)} live={state === 'live'} />
    </div>
  );
}

type Act = (prev: AssistanceActionState, form: FormData) => Promise<AssistanceActionState>;

/**
 * One request's controls (M3.3b): Take it, Assign to (a staff member), Start, Resolve, Cancel and
 * a note. Plain forms (keyboard: Tab, then Enter or Space); each button's accessible name says
 * which request it acts on; the outcome is announced politely and stays when the list re-renders.
 */
export function RequestActions({
  requestId,
  title,
  state,
  mine,
  staff,
  action,
}: {
  requestId: string;
  title: string;
  state: 'new' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
  mine: boolean;
  staff: readonly { id: string; name: string }[];
  action: Act;
}) {
  const t = useTranslations('assistance');
  const te = useTranslations();
  const [result, formAction, pending] = useActionState(action, { kind: 'idle' });
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (result.kind === 'done' && result.op === 'note' && noteRef.current) noteRef.current.value = '';
  }, [result]);
  const button = (
    op: string,
    label: string,
    aria: string,
    variant: 'primary' | 'secondary' = 'secondary',
  ) => (
    <form action={formAction}>
      <input type="hidden" name="op" value={op} />
      <Button type="submit" size="sm" variant={variant} disabled={pending} aria-label={aria}>
        {label}
      </Button>
    </form>
  );
  const errorText =
    result.kind !== 'error'
      ? null
      : result.field === 'assignee'
        ? t('errors.assignee')
        : result.field === 'body'
          ? t('errors.note')
          : result.code === 'conflict' || result.code === 'invalid_state'
            ? t('changed')
            : te(errorMessageKey(result.code));
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3">
      <div className="flex flex-wrap items-end gap-2">
        {!mine ? button('take', t('take'), t('takeLabel', { title }), 'primary') : null}
        {state !== 'in_progress' ? button('start', t('start'), t('startLabel', { title })) : null}
        {button('resolve', t('resolve'), t('resolveLabel', { title }))}
        {button('cancel', t('cancel'), t('cancelLabel', { title }))}
      </div>
      {staff.length > 0 ? (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="op" value="assign" />
          <div className="flex flex-col gap-1">
            <label htmlFor={`assign-${requestId}`} className="text-caption text-zinc-600">
              {t('assignLabel', { title })}
            </label>
            <select
              id={`assign-${requestId}`}
              name="assignee"
              defaultValue=""
              className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
            >
              <option value="">{t('choosePerson')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {t('assign')}
          </Button>
        </form>
      ) : null}
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="op" value="note" />
        <label htmlFor={`note-${requestId}`} className="text-caption text-zinc-600">
          {t('noteLabel', { title })}
        </label>
        <textarea
          id={`note-${requestId}`}
          ref={noteRef}
          name="body"
          rows={2}
          maxLength={500}
          className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={pending} className="self-start">
          {t('addNote')}
        </Button>
      </form>
      <div
        role="status"
        aria-live="polite"
        className="text-body font-medium"
        data-testid="assistance-message"
      >
        {result.kind === 'done' ? t(`done.${result.op}`, { title }) : null}
      </div>
      {errorText ? <Alert title={errorText} /> : null}
    </div>
  );
}
