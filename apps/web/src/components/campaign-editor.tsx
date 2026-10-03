'use client';

import type { CampaignDraftDto } from '@yayatoh/ai';
import {
  BLOCK_TYPES,
  type Block,
  type BlockType,
  CAMPAIGN_FONTS,
  type CampaignContent,
  MERGE_FIELDS,
  moveBlock,
  newBlockId,
} from '@yayatoh/campaigns/client';
import { Alert, Button, Card, cx, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { CampaignFormState, PreviewResult } from '@/app/[locale]/o/[org]/(org)/campaigns/actions.ts';
import { AiComposePanel } from '@/components/ai-compose-panel.tsx';
import type { AiComposeResult, AiComposeSetup, AiComposeValues } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface EditorEvent {
  readonly id: string;
  readonly name: string;
  readonly date: string;
}

const INITIAL: CampaignFormState = { ok: false, code: null };
const ADDABLE = BLOCK_TYPES.filter((t) => t !== 'footer');
const LOCALES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ar', 'hi', 'ja', 'zh-CN', 'zh-TW'] as const;
const FIELD = 'field';
const AREA = 'rounded-card border border-line bg-surface px-4 py-3 text-body';

function blankBlock(type: BlockType, id: string, eventId: string): Block {
  switch (type) {
    case 'heading':
      return { id, type, text: '' };
    case 'text':
      return { id, type, text: '' };
    case 'image':
      return { id, type, src: '', alt: '' };
    case 'button':
      return { id, type, label: '', eventId, path: null };
    case 'eventCard':
      return { id, type, eventId };
    case 'divider':
      return { id, type };
    case 'footer':
      return { id, type, postalAddress: '', note: '' };
  }
}

/**
 * The campaign block editor (M3.6b). Blocks are a list of native form controls: each can be moved
 * up or down with buttons (the keyboard alternative to dragging) or removed; the footer (postal
 * address and the unsubscribe link) is always last and can't be removed. The preview renders the
 * email as recipients will see it, in a desktop or a mobile frame.
 */
export function CampaignEditor({
  campaignId,
  channel,
  initial,
  events,
  save,
  preview,
  initialPreview,
  ai,
}: {
  campaignId: string;
  channel: 'email' | 'sms' | 'whatsapp';
  initial: { name: string; locale: string; content: CampaignContent };
  events: readonly EditorEvent[];
  save: (prev: CampaignFormState, form: FormData) => Promise<CampaignFormState>;
  preview: (contentJson: string | null) => Promise<PreviewResult>;
  initialPreview: PreviewResult | null;
  /** M6.12b: "Draft with AI" (only for people who may send messages). */
  ai?: {
    setup: AiComposeSetup;
    draft: (values: AiComposeValues) => Promise<AiComposeResult<CampaignDraftDto>>;
  };
}) {
  const t = useTranslations('campaigns');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(save, INITIAL);
  const [content, setContent] = useState<CampaignContent>(initial.content);
  const [addType, setAddType] = useState<BlockType>('text');
  const [frame, setFrame] = useState<'desktop' | 'mobile'>('desktop');
  const [shown, setShown] = useState<PreviewResult | null>(initialPreview);
  const [previewing, startPreview] = useTransition();
  const focusNext = useRef<string | null>(null);
  const lastAiEvent = useRef('');
  const errors = state.errors ?? {};
  const err = (path: string) => errors[path];
  const firstEvent = events[0]?.id ?? '';

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const update = (id: string, patch: Partial<Block>) =>
    setContent((c) => ({
      ...c,
      blocks: c.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
    }));
  const add = () => {
    const id = newBlockId(content.blocks);
    const block = blankBlock(addType, id, firstEvent);
    const at = content.blocks.findIndex((b) => b.type === 'footer');
    const blocks = [...content.blocks];
    blocks.splice(at < 0 ? blocks.length : at, 0, block);
    setContent({ ...content, blocks });
    focusNext.current = `block-${id}-legend`;
  };
  const move = (id: string, dir: -1 | 1) => {
    setContent((c) => ({ ...c, blocks: moveBlock(c.blocks, id, dir) }));
    focusNext.current = `block-${id}-${dir < 0 ? 'up' : 'down'}`;
  };
  const remove = (index: number, id: string) => {
    const before = content.blocks[index - 1] ?? content.blocks[index + 1];
    setContent((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }));
    focusNext.current = before ? `block-${before.id}-legend` : 'campaign-add-type';
  };
  // M6.12b: an AI draft replaces the subject, the preheader and the heading/text/button blocks
  // (images, event cards, dividers and the footer stay); nothing is saved until "Save".
  const applyDraft = (d: CampaignDraftDto, eventId: string) => {
    setContent((c) => {
      const kept = c.blocks.filter((b) => b.type !== 'heading' && b.type !== 'text' && b.type !== 'button');
      const fresh: Block[] = [];
      const next = () => newBlockId([...kept, ...fresh]);
      fresh.push({ id: next(), type: 'heading', text: d.heading });
      for (const p of d.paragraphs) fresh.push({ id: next(), type: 'text', text: p });
      const target = eventId || firstEvent;
      if (d.buttonLabel && target)
        fresh.push({ id: next(), type: 'button', label: d.buttonLabel, eventId: target, path: null });
      return { ...c, subject: d.subject, preheader: d.preheader, blocks: [...fresh, ...kept] };
    });
    focusNext.current = 'subject';
  };
  const refreshPreview = () =>
    startPreview(async () => {
      setShown(await preview(JSON.stringify(content)));
    });

  const typeName = (type: BlockType) => t(`blockTypes.${type}`);
  const errorText = (path: string) =>
    err(path) ? (
      <p id={`${path}-error`} className="text-caption text-danger">
        {t(`errors.${err(path)}`)}
      </p>
    ) : null;
  const described = (path: string) =>
    err(path) ? { 'aria-invalid': true, 'aria-describedby': `${path}-error` } : {};

  return (
    <div className="flex flex-col gap-6">
      {ai ? (
        <Card>
          <section aria-labelledby="campaign-ai" className="flex flex-col gap-3">
            <h2 id="campaign-ai" className="text-section">
              {t('ai.title')}
            </h2>
            <p className="text-body text-ink-2">{t('ai.explainer')}</p>
            <AiComposePanel<CampaignDraftDto>
              setup={ai.setup}
              run={(v) => {
                lastAiEvent.current = v.eventId;
                return ai.draft(v);
              }}
              events={events}
              briefLabel={t('ai.brief')}
              renderPreview={(d, done) => (
                <div className="flex flex-col gap-2">
                  <p className="text-body">
                    <span className="font-bold">{t('subject')}: </span>
                    <span data-testid="ai-subject">{d.subject}</span>
                  </p>
                  {d.preheader ? <p className="text-caption text-ink-2">{d.preheader}</p> : null}
                  <p className="text-body font-bold" data-testid="ai-heading">
                    {d.heading}
                  </p>
                  {d.paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-line text-body">
                      {p}
                    </p>
                  ))}
                  {d.buttonLabel ? (
                    <p className="text-caption">{t('ai.button', { label: d.buttonLabel })}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={() => {
                        applyDraft(d, lastAiEvent.current);
                        done(t('ai.applied'));
                      }}
                    >
                      {t('ai.apply')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => done(t('ai.discarded'))}>
                      {t('ai.discard')}
                    </Button>
                  </div>
                </div>
              )}
            />
          </section>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={formAction} className="flex flex-col gap-5" aria-label={t('editorTitle')} noValidate>
          <input type="hidden" name="content" value={JSON.stringify(content)} />
          <div role="status" aria-live="polite">
            {state.ok && state.message === 'saved' ? (
              <p className="text-body font-medium">{t('saved')}</p>
            ) : null}
          </div>
          {state.code && !state.ok && state.code !== 'validation_failed' ? (
            <Alert
              title={
                state.reason === 'event_not_found'
                  ? t('errors.event_not_found')
                  : tr(errorMessageKey(state.code))
              }
            />
          ) : state.code === 'validation_failed' ? (
            <Alert title={t('errors.fixFields')} />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-[13px] font-bold text-ink">
                {t('name')}
              </label>
              <input
                id="name"
                name="name"
                defaultValue={initial.name}
                maxLength={120}
                className={FIELD}
                {...described('name')}
              />
              {errorText('name')}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="campaign-locale" className="text-[13px] font-bold text-ink">
                {t('language')}
              </label>
              <Select id="campaign-locale" name="locale" defaultValue={initial.locale} className={FIELD}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`languages.${l}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="subject" className="text-[13px] font-bold text-ink">
              {t('subject')}
            </label>
            <input
              id="subject"
              value={content.subject}
              onChange={(e) => setContent({ ...content, subject: e.target.value })}
              maxLength={150}
              className={FIELD}
              {...described('subject')}
            />
            {errorText('subject')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="preheader" className="text-[13px] font-bold text-ink">
                {t('preheader')}
              </label>
              <input
                id="preheader"
                value={content.preheader}
                onChange={(e) => setContent({ ...content, preheader: e.target.value })}
                maxLength={150}
                className={FIELD}
                {...described('preheader')}
              />
              {errorText('preheader')}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="font" className="text-[13px] font-bold text-ink">
                {t('font')}
              </label>
              <Select
                id="font"
                value={content.font}
                onValueChange={(v) => setContent({ ...content, font: v as CampaignContent['font'] })}
                className={FIELD}
              >
                {CAMPAIGN_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {t(`fonts.${f}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {channel !== 'email' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="smsBody" className="text-[13px] font-bold text-ink">
                {t('smsBody')}
              </label>
              <textarea
                id="smsBody"
                value={content.smsBody}
                onChange={(e) => setContent({ ...content, smsBody: e.target.value })}
                rows={3}
                maxLength={800}
                className={AREA}
                {...described('smsBody')}
              />
              <p className="text-caption text-ink-2">{t('smsHint')}</p>
              {errorText('smsBody')}
            </div>
          ) : null}
          <p className="text-caption text-ink-2">
            {t('mergeHelp', {
              fields: MERGE_FIELDS.map((f) => `{{${f}}}`).join(', '),
              example: '{{first_name|there}}',
            })}
          </p>
          {errorText('blocks')}
          <ol className="flex flex-col gap-4" aria-label={t('blocksTitle')}>
            {content.blocks.map((b, i) => {
              const p = (field: string) => `blocks.${i}.${field}`;
              const id = (field: string) => `block-${b.id}-${field}`;
              const label = t('blockLabel', { n: i + 1, type: typeName(b.type) });
              return (
                <li key={b.id}>
                  <fieldset className="flex flex-col gap-3 rounded-card border border-line p-4">
                    <legend
                      id={id('legend')}
                      tabIndex={-1}
                      className="px-1 text-caption font-medium text-ink-2 focus:outline-2"
                    >
                      {label}
                    </legend>
                    {b.type === 'heading' || b.type === 'text' ? (
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={id('text')} className="text-[13px] font-bold text-ink">
                          {b.type === 'heading' ? t('headingText') : t('bodyText')}
                        </label>
                        {b.type === 'heading' ? (
                          <input
                            id={id('text')}
                            value={b.text}
                            maxLength={200}
                            onChange={(e) => update(b.id, { text: e.target.value })}
                            className={FIELD}
                            {...described(p('text'))}
                          />
                        ) : (
                          <textarea
                            id={id('text')}
                            value={b.text}
                            rows={4}
                            maxLength={5000}
                            onChange={(e) => update(b.id, { text: e.target.value })}
                            className={AREA}
                            {...described(p('text'))}
                          />
                        )}
                        {errorText(p('text'))}
                      </div>
                    ) : null}
                    {b.type === 'image' ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={id('src')} className="text-[13px] font-bold text-ink">
                            {t('imageUrl')}
                          </label>
                          <input
                            id={id('src')}
                            value={b.src}
                            inputMode="url"
                            onChange={(e) => update(b.id, { src: e.target.value })}
                            className={FIELD}
                            {...described(p('src'))}
                          />
                          {errorText(p('src'))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={id('alt')} className="text-[13px] font-bold text-ink">
                            {t('imageAlt')}
                          </label>
                          <input
                            id={id('alt')}
                            value={b.alt}
                            maxLength={300}
                            onChange={(e) => update(b.id, { alt: e.target.value })}
                            className={FIELD}
                            {...described(p('alt'))}
                          />
                          {errorText(p('alt'))}
                        </div>
                      </>
                    ) : null}
                    {b.type === 'button' ? (
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={id('label')} className="text-[13px] font-bold text-ink">
                          {t('buttonLabel')}
                        </label>
                        <input
                          id={id('label')}
                          value={b.label}
                          maxLength={80}
                          onChange={(e) => update(b.id, { label: e.target.value })}
                          className={FIELD}
                          {...described(p('label'))}
                        />
                        {errorText(p('label'))}
                      </div>
                    ) : null}
                    {b.type === 'button' || b.type === 'eventCard' ? (
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={id('event')} className="text-[13px] font-bold text-ink">
                          {b.type === 'button' ? t('buttonEvent') : t('cardEvent')}
                        </label>
                        <Select
                          id={id('event')}
                          value={b.eventId}
                          onValueChange={(v) => update(b.id, { eventId: v })}
                          className={FIELD}
                          {...described(p('eventId'))}
                        >
                          {events.length === 0 ? <option value="">{t('noEvents')}</option> : null}
                          {events.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name} · {e.date}
                            </option>
                          ))}
                        </Select>
                        <p className="text-caption text-ink-2">{t('trackedHint')}</p>
                        {errorText(p('eventId'))}
                      </div>
                    ) : null}
                    {b.type === 'button' ? (
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={id('path')} className="text-[13px] font-bold text-ink">
                          {t('buttonPath')}
                        </label>
                        <input
                          id={id('path')}
                          value={b.path ?? ''}
                          onChange={(e) =>
                            update(b.id, { path: e.target.value.trim() ? e.target.value : null })
                          }
                          className={FIELD}
                          {...described(p('path'))}
                        />
                        {errorText(p('path'))}
                      </div>
                    ) : null}
                    {b.type === 'divider' ? (
                      <p className="text-caption text-ink-2">{t('dividerHint')}</p>
                    ) : null}
                    {b.type === 'footer' ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={id('address')} className="text-[13px] font-bold text-ink">
                            {t('postalAddress')}
                          </label>
                          <input
                            id={id('address')}
                            value={b.postalAddress}
                            maxLength={300}
                            onChange={(e) => update(b.id, { postalAddress: e.target.value })}
                            className={FIELD}
                            {...described(p('postalAddress'))}
                          />
                          {errorText(p('postalAddress'))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={id('note')} className="text-[13px] font-bold text-ink">
                            {t('footerNote')}
                          </label>
                          <input
                            id={id('note')}
                            value={b.note}
                            maxLength={300}
                            onChange={(e) => update(b.id, { note: e.target.value })}
                            className={FIELD}
                          />
                        </div>
                        <p className="text-caption text-ink-2">{t('footerHint')}</p>
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          id={id('up')}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => move(b.id, -1)}
                          disabled={i === 0}
                          aria-label={t('moveUp', { block: label })}
                        >
                          {t('up')}
                        </Button>
                        <Button
                          id={id('down')}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => move(b.id, 1)}
                          disabled={content.blocks[i + 1]?.type === 'footer'}
                          aria-label={t('moveDown', { block: label })}
                        >
                          {t('down')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => remove(i, b.id)}
                          aria-label={t('removeBlock', { block: label })}
                        >
                          {t('remove')}
                        </Button>
                      </div>
                    )}
                  </fieldset>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="campaign-add-type" className="text-[13px] font-bold text-ink">
                {t('blockType')}
              </label>
              <Select
                id="campaign-add-type"
                value={addType}
                onValueChange={(v) => setAddType(v as BlockType)}
                className={FIELD}
              >
                {ADDABLE.map((type) => (
                  <option key={type} value={type}>
                    {typeName(type)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" variant="secondary" onClick={add} disabled={content.blocks.length >= 40}>
              {t('addBlock')}
            </Button>
          </div>
          <Button type="submit" disabled={pending} className="self-start">
            {t('save')}
          </Button>
        </form>
        <section aria-labelledby={`preview-${campaignId}`} className="flex flex-col gap-3">
          <h2 id={`preview-${campaignId}`} className="text-section">
            {t('previewTitle')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {(['desktop', 'mobile'] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={frame === f ? 'primary' : 'secondary'}
                aria-pressed={frame === f}
                onClick={() => setFrame(f)}
              >
                {t(`frames.${f}`)}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={refreshPreview}
              disabled={previewing}
            >
              {t('refreshPreview')}
            </Button>
          </div>
          <div role="status" aria-live="polite" className="text-caption text-ink-2">
            {previewing ? t('previewing') : shown && !shown.ok ? t('errors.previewFailed') : null}
          </div>
          {shown?.ok && shown.src ? (
            <>
              <p className="text-caption text-ink-2">
                {t('previewSubject', { subject: shown.subject ?? '' })}
              </p>
              {shown.sms ? (
                <p className="whitespace-pre-line rounded-card border border-line bg-surface-2 px-4 py-3 text-body">
                  {shown.sms}
                </p>
              ) : null}
              <iframe
                key={`${shown.src}-${frame}`}
                title={t('previewFrame', { frame: t(`frames.${frame}`) })}
                src={shown.src}
                sandbox=""
                data-frame={frame}
                className={cx(
                  'h-[560px] rounded-card border border-line bg-surface',
                  frame === 'mobile' ? 'w-full max-w-[375px]' : 'w-full',
                )}
              />
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
