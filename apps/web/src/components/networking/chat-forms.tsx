'use client';

import { Button, Field } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * Block (or unblock) and report one booth chat (M5.8b), from either side: an attendee about a
 * booth, a booth's people about a visitor. Composed from `@yayatoh/ui` primitives behind a
 * disclosure; every refusal shows next to its form, and a report leaves for `after`.
 */
export function ChatSafety({
  summary,
  block,
  report,
  reasons,
  after,
}: {
  summary: string;
  block: {
    readonly action: (prev: FormState) => Promise<FormState>;
    readonly label: string;
    readonly help: string;
    readonly danger: boolean;
  };
  report: { readonly action: Action; readonly label: string; readonly help: string } | null;
  reasons: readonly { value: string; label: string }[];
  after: string;
}) {
  const t = useTranslations('chat');
  const tAll = useTranslations();
  const id = useId();
  const router = useRouter();
  const [blocked, blockAction, blocking] = useActionState(block.action, INITIAL_FORM_STATE);
  const [reported, reportAction, reporting] = useActionState(
    report?.action ?? (async () => INITIAL_FORM_STATE),
    INITIAL_FORM_STATE,
  );
  useEffect(() => {
    if (reported.ok) router.push(after);
  }, [reported, router, after]);
  const refusal = (s: FormState) => {
    if (s.ok || !s.code) return null;
    const key = `chat.errors.${s.reason ?? s.code}`;
    return tAll.has(key) ? tAll(key) : tAll(errorMessageKey(s.code));
  };
  const bad = new Set(reported.fields ?? []);
  const reasonError = bad.has('reason') ? t('safety.reasonRequired') : null;
  const detailsError = bad.has('details') ? t('safety.detailsRequired') : null;
  const reportRefusal = reasonError || detailsError ? null : refusal(reported);
  const blockRefusal = refusal(blocked);
  return (
    <details className="rounded-card border border-line bg-surface p-4">
      <summary className="min-h-11 cursor-pointer content-center font-bold text-ink">{summary}</summary>
      <div className="flex flex-col gap-6 pt-4">
        <form action={blockAction} className="flex flex-col gap-2">
          <p className="text-body text-ink-2">{block.help}</p>
          <Button
            type="submit"
            variant={block.danger ? 'danger' : 'secondary'}
            loading={blocking}
            className="self-start"
          >
            {block.label}
          </Button>
          {blockRefusal && !blocking ? (
            <p role="alert" className="text-caption text-danger">
              {blockRefusal}
            </p>
          ) : null}
        </form>
        {report ? (
          <form
            action={reportAction}
            onSubmit={keepValues(reportAction)}
            className="flex flex-col gap-3"
            noValidate
          >
            <p className="text-body text-ink-2">{report.help}</p>
            <Field id={`${id}-reason`} label={t('safety.reason')} error={reasonError ?? undefined}>
              <select
                id={`${id}-reason`}
                name="reason"
                defaultValue=""
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? `${id}-reason-error` : undefined}
                className="field"
              >
                <option value="">{t('safety.chooseReason')}</option>
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id={`${id}-details`}
              label={t('safety.details')}
              hint={t('safety.detailsHint')}
              error={detailsError ?? undefined}
            >
              <textarea
                id={`${id}-details`}
                name="details"
                rows={3}
                maxLength={500}
                aria-invalid={detailsError ? true : undefined}
                aria-describedby={detailsError ? `${id}-details-error` : `${id}-details-hint`}
                className="field py-3"
              />
            </Field>
            {reportRefusal && !reporting ? (
              <p role="alert" className="text-caption text-danger">
                {reportRefusal}
              </p>
            ) : null}
            <Button type="submit" variant="danger" loading={reporting} className="self-start">
              {report.label}
            </Button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

/** One switch-like action that refreshes the page (booth chat on/off, unblock …). */
export function ChatActionButton({
  action,
  label,
  variant = 'secondary',
}: {
  action: (prev: FormState) => Promise<FormState>;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const tAll = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const refusal =
    !state.ok && state.code
      ? tAll.has(`chat.errors.${state.reason ?? state.code}`)
        ? tAll(`chat.errors.${state.reason ?? state.code}`)
        : tAll(errorMessageKey(state.code))
      : null;
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <Button type="submit" variant={variant} loading={pending} className="self-start">
        {label}
      </Button>
      {refusal && !pending ? (
        <p role="alert" className="text-caption text-danger">
          {refusal}
        </p>
      ) : null}
    </form>
  );
}
