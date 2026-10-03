'use client';

import { MAX_BRIEF_LENGTH, TONES, type Tone } from '@yayatoh/ai/ui';
import { Alert, Button, Select, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState, useTransition } from 'react';
import type { AiComposeResult, AiComposeSetup, AiComposeValues } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * M6.12b "Draft with AI" for campaigns, pages and agendas (and, without tone and kit, audience
 * suggestions): the organizer picks a tone and a brand kit and says what they want; the result is
 * a preview they apply, edit or discard. Nothing is sent, published or saved by AI. Credits and
 * failures are announced in a live region; focus moves to the preview when it arrives.
 */
export function AiComposePanel<T>({
  setup,
  run,
  renderPreview,
  briefLabel,
  briefHint,
  briefRequired = false,
  events,
  voice = true,
  draftLabel,
  extra,
}: {
  setup: AiComposeSetup;
  run: (values: AiComposeValues) => Promise<AiComposeResult<T>>;
  /** The preview of a result; `done` clears it (after applying or discarding). */
  renderPreview: (value: T, done: (message?: string) => void) => ReactNode;
  briefLabel: string;
  briefHint?: string;
  briefRequired?: boolean;
  /** Optional event the draft is about (campaigns, pages). */
  events?: readonly { readonly id: string; readonly name: string }[];
  /** Tone and brand kit pickers (off for audience suggestions). */
  voice?: boolean;
  draftLabel?: string;
  /** More fields, rendered after the brief (e.g. how many sessions). */
  extra?: ReactNode;
}) {
  const t = useTranslations('aiCompose');
  const te = useTranslations();
  const id = useId();
  const defaultKit = setup.kits.find((k) => k.isDefault) ?? null;
  const [tone, setTone] = useState<Tone>(defaultKit?.tone ?? 'friendly');
  const [kitId, setKitId] = useState(defaultKit?.id ?? '');
  const [eventId, setEventId] = useState('');
  const [brief, setBrief] = useState('');
  const [briefError, setBriefError] = useState<string | null>(null);
  const [balance, setBalance] = useState(setup.balance);
  const [value, setValue] = useState<T | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const previewRef = useRef<HTMLDivElement>(null);
  const focusPreview = useRef(false);
  const out = balance <= 0;

  useEffect(() => {
    if (value !== null && focusPreview.current) {
      focusPreview.current = false;
      previewRef.current?.focus();
    }
  }, [value]);

  const onKit = (next: string) => {
    setKitId(next);
    const kit = setup.kits.find((k) => k.id === next);
    if (kit) setTone(kit.tone);
  };

  const onDraft = () => {
    if (briefRequired && brief.trim().length < 3) {
      setBriefError(t('briefRequired'));
      document.getElementById(`${id}-brief`)?.focus();
      return;
    }
    setBriefError(null);
    start(async () => {
      setMessage(null);
      const res = await run({ tone, brandKitId: kitId, brief, eventId });
      if (res.balance !== undefined) setBalance(res.balance);
      if (res.ok && res.value !== undefined) {
        setValue(res.value);
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
  };

  const done = (text?: string) => {
    setValue(null);
    setMessage(text ? { tone: 'info', text } : null);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-ink-2" aria-live="polite" data-testid="ai-credits">
        {t('credits', { balance, allowance: setup.allowance })}
      </p>
      {!setup.enabled ? (
        <Alert tone="info" title={t('unavailableTitle')}>
          {t('unavailableDescription')}
        </Alert>
      ) : out ? (
        <Alert title={t('outOfCreditsTitle')}>{t('outOfCredits')}</Alert>
      ) : null}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onDraft();
        }}
      >
        {voice ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id={`${id}-tone`}
              label={t('tone')}
              value={tone}
              onValueChange={(v) => setTone(v as Tone)}
              options={TONES.map((k) => ({ value: k, label: t(`tones.${k}`), text: t(`tones.${k}`) }))}
            />
            <Select
              id={`${id}-kit`}
              label={t('brandKit')}
              value={kitId}
              onValueChange={onKit}
              options={[
                { value: '', label: t('noBrandKit'), text: t('noBrandKit') },
                ...setup.kits.map((k) => ({ value: k.id, label: k.name, text: k.name })),
              ]}
              hint={setup.kits.length === 0 ? t('noBrandKitsHint') : undefined}
            />
          </div>
        ) : null}
        {events && events.length > 0 ? (
          <Select
            id={`${id}-event`}
            label={t('event')}
            value={eventId}
            onValueChange={setEventId}
            options={[
              { value: '', label: t('noEvent'), text: t('noEvent') },
              ...events.map((e) => ({ value: e.id, label: e.name, text: e.name })),
            ]}
          />
        ) : null}
        <Textarea
          id={`${id}-brief`}
          label={briefLabel}
          rows={3}
          maxLength={MAX_BRIEF_LENGTH}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          hint={briefError ? undefined : (briefHint ?? t('briefHint'))}
          error={briefError ?? undefined}
          required={briefRequired}
        />
        {extra}
        <div>
          <Button
            type="submit"
            variant="secondary"
            disabled={pending || out || !setup.enabled}
            aria-busy={pending || undefined}
          >
            {pending ? t('drafting') : (draftLabel ?? t('draft'))}
          </Button>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {message ? (
          message.tone === 'info' ? (
            <p className="text-body font-medium">{message.text}</p>
          ) : (
            <Alert title={message.text} />
          )
        ) : null}
      </div>
      {value !== null ? (
        <section
          ref={previewRef}
          tabIndex={-1}
          aria-labelledby={`${id}-preview`}
          className="flex flex-col gap-3 rounded-card border border-line p-4 focus:outline-2"
        >
          <h3 id={`${id}-preview`} className="text-body font-bold">
            {t('previewTitle')}
          </h3>
          <p className="text-caption text-ink-2">{t('previewNote')}</p>
          {renderPreview(value, done)}
        </section>
      ) : null}
    </div>
  );
}
