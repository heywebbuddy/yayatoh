'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

export type FormState = { readonly done: boolean; readonly code: string | null };
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function Problem({ code }: { code: string | null }) {
  const t = useTranslations();
  if (!code) return null;
  const known = ['blocked', 'blocked_by_contact', 'you_blocked', 'required'].includes(code);
  return <Alert title={known ? t(`conversation.errors.${code}`) : t(errorMessageKey(code))} />;
}

/** Write a message (organizer reply or contact message); announces "sent" and clears itself. */
export function MessageForm({ action, label, submit }: { action: Action; label: string; submit: string }) {
  const t = useTranslations('conversation');
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, form: FormData) => {
      const next = await action(prev, form);
      if (next.done) ref.current?.reset();
      return next;
    },
    { done: false, code: null },
  );
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-2" noValidate>
      <label htmlFor="conversation-body" className="text-caption text-zinc-600">
        {label}
      </label>
      <textarea
        id="conversation-body"
        name="body"
        rows={4}
        maxLength={2000}
        aria-invalid={state.code === 'required' ? true : undefined}
        className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
      />
      <div role="status" aria-live="polite">
        {state.done ? <p className="text-body font-medium">{t('sent')}</p> : null}
      </div>
      <Problem code={state.code} />
      <Button type="submit" disabled={pending} className="self-start">
        {submit}
      </Button>
    </form>
  );
}

/** Block or unblock; the current state is announced. */
export function BlockToggle({
  action,
  blocked,
  blockLabel,
  unblockLabel,
  blockedText,
}: {
  action: Action;
  blocked: boolean;
  blockLabel: string;
  unblockLabel: string;
  blockedText: string;
}) {
  const [state, formAction, pending] = useActionState(action, { done: false, code: null });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="blocked" value={blocked ? 'no' : 'yes'} />
      <div role="status" aria-live="polite">
        {blocked ? <p className="text-body font-medium">{blockedText}</p> : null}
      </div>
      <Problem code={state.code} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {blocked ? unblockLabel : blockLabel}
      </Button>
    </form>
  );
}

/** Report the conversation to Yayatoh with a reason and an optional note. */
export function ReportForm({ action, done }: { action: Action; done?: boolean }) {
  const t = useTranslations('conversation');
  const [state, formAction, pending] = useActionState(action, { done: Boolean(done), code: null });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-reason" className="text-caption text-zinc-600">
          {t('reportReason')}
        </label>
        <select
          id="report-reason"
          name="reason"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          <option value="spam">{t('reasons.spam')}</option>
          <option value="abuse">{t('reasons.abuse')}</option>
          <option value="other">{t('reasons.other')}</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-note" className="text-caption text-zinc-600">
          {t('reportNote')}
        </label>
        <textarea
          id="report-note"
          name="note"
          rows={2}
          maxLength={1000}
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
        />
      </div>
      <div role="status" aria-live="polite">
        {state.done ? <p className="text-body font-medium">{t('reported')}</p> : null}
      </div>
      <Problem code={state.code} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('report')}
      </Button>
    </form>
  );
}
