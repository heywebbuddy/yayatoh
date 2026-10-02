'use client';

import { DRAFT_KINDS, type DraftKind, MAX_NOTES_LENGTH } from '@yayatoh/ai/ui';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { AiDraftState } from '@/app/[locale]/o/[org]/e/[event]/content/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FormState } from '@/lib/form-state.ts';

const area = 'rounded-card border bg-surface px-4 py-2 text-body';

/**
 * "Draft with AI" (M1.4f). The organizer picks what to draft and may add notes; the draft comes
 * back as an editable preview that they accept (saved through the normal event commands), edit
 * or reject. Nothing is ever published automatically. Credits and the out-of-credits state are
 * announced in a live region.
 */
export function AiDraftPanel({
  draft,
  accept,
  balance: initialBalance,
  allowance,
  enabled,
}: {
  draft: (kind: DraftKind, notes: string) => Promise<AiDraftState>;
  accept: (kind: DraftKind, text: string) => Promise<FormState>;
  balance: number;
  allowance: number;
  /** False when no AI provider is configured for this deployment. */
  enabled: boolean;
}) {
  const t = useTranslations('aiDraft');
  const te = useTranslations();
  const id = useId();
  const [kind, setKind] = useState<DraftKind>('tagline');
  const [notes, setNotes] = useState('');
  const [balance, setBalance] = useState(initialBalance);
  const [preview, setPreview] = useState<{ kind: DraftKind; text: string } | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const out = balance <= 0;
  // Move focus to a new preview so keyboard and screen-reader users land on the result.
  const focusPreview = useRef(false);
  useEffect(() => {
    if (preview && focusPreview.current) {
      focusPreview.current = false;
      previewRef.current?.focus();
    }
  }, [preview]);

  const onDraft = () =>
    start(async () => {
      setMessage(null);
      const res = await draft(kind, notes);
      if (res.ok && res.text !== undefined && res.kind) {
        setBalance(res.balance ?? balance);
        setPreview({ kind: res.kind, text: res.text });
        focusPreview.current = true;
        return;
      }
      if (res.reason === 'out_of_credits') setBalance(0);
      setMessage({
        tone: 'danger',
        text:
          res.code === 'rate_limited'
            ? t('rateLimited', { minutes: res.retryMinutes ?? 1 })
            : res.reason === 'out_of_credits'
              ? t('outOfCredits')
              : res.reason === 'ai_unavailable' || res.reason === 'ai_output'
                ? t(`errors.${res.reason}`)
                : te(errorMessageKey(res.code)),
      });
    });

  const onAccept = () =>
    start(async () => {
      if (!preview) return;
      const res = await accept(preview.kind, preview.text);
      if (res.ok) {
        setMessage({ tone: 'info', text: t(`accepted.${preview.kind}`) });
        setPreview(null);
      } else {
        setMessage({
          tone: 'danger',
          text: res.reason ? t('errors.faqFormat') : te(errorMessageKey(res.code)),
        });
      }
    });

  const onReject = () => {
    setPreview(null);
    setMessage({ tone: 'info', text: t('rejected') });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-2">{t('explainer')}</p>
      <p className="text-caption text-ink-2" aria-live="polite" data-testid="ai-credits">
        {t('credits', { balance, allowance })}
      </p>
      {!enabled ? (
        <Alert tone="info" title={t('unavailableTitle')}>
          {t('unavailableDescription')}
        </Alert>
      ) : out ? (
        <Alert title={t('outOfCreditsTitle')}>{t('outOfCredits')}</Alert>
      ) : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onDraft();
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-caption text-ink-2">{t('what')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {DRAFT_KINDS.map((k) => (
              <label key={k} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="size-5"
                />
                {t(`kinds.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-notes`} className="text-caption text-ink-2">
            {t('notes')}
          </label>
          <textarea
            id={`${id}-notes`}
            rows={3}
            maxLength={MAX_NOTES_LENGTH}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby={`${id}-notes-hint`}
            className={`${area} border-line`}
          />
          <p id={`${id}-notes-hint`} className="text-caption text-ink-2">
            {t('notesHint')}
          </p>
        </div>
        <Button type="submit" disabled={pending || out || !enabled} className="self-start">
          {pending && !preview ? t('drafting') : t('draft')}
        </Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? <Alert tone={message.tone} title={message.text} /> : null}
      </div>
      {preview ? (
        <section
          aria-labelledby={`${id}-preview-heading`}
          className="flex flex-col gap-3 rounded-card border border-line p-4"
        >
          <h3 id={`${id}-preview-heading`} className="text-section">
            {t('previewTitle', { kind: t(`kinds.${preview.kind}`) })}
          </h3>
          <p className="text-caption text-ink-2">{t('previewHint')}</p>
          <label htmlFor={`${id}-preview`} className="text-caption text-ink-2">
            {t('previewLabel')}
          </label>
          <textarea
            id={`${id}-preview`}
            ref={previewRef}
            rows={preview.kind === 'tagline' ? 2 : 8}
            value={preview.text}
            onChange={(e) => setPreview({ ...preview, text: e.target.value })}
            className={`${area} border-line`}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onAccept} disabled={pending || !preview.text.trim()}>
              {t('accept')}
            </Button>
            <Button type="button" variant="secondary" onClick={onReject} disabled={pending}>
              {t('reject')}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
