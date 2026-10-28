'use client';

import {
  isUploadedVideo,
  parseVideoUrl,
  SECTION_KINDS,
  type SectionBody,
  type SectionKind,
} from '@yayatoh/events/ui';
import { Alert, Button, Input, Select } from '@yayatoh/ui';
import { ArrowDown, ArrowUp, CalendarDays, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useEffect, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';
import { MarkdownField } from './markdown-field.tsx';
import { SectionBodyView } from './section-body.tsx';
import { VideoField } from './video-field.tsx';

export interface SectionValues {
  readonly title: string;
  readonly visible: boolean;
  /** Text-shaped fields (text, location): field name → text. */
  readonly fields: Readonly<Record<string, string>>;
  /** List-shaped kinds, as stored. */
  readonly schedule?: readonly {
    time: string | null;
    title: string;
    detail: string | null;
    day: string | null;
  }[];
  readonly faq?: readonly { question: string; answer: string }[];
  readonly links?: readonly { label: string; url: string }[];
  /** Video: the pasted link and an optional caption. */
  readonly video?: { url: string; poster?: string | null; caption: string | null };
}

type ScheduleRow = { key: number; heading: boolean; time: string; title: string; detail: string };
type FaqRow = { key: number; question: string; answer: string };
type LinkRow = { key: number; label: string; url: string };

let rowKey = 0;
const nextKey = () => {
  rowKey += 1;
  return rowKey;
};

/** Stored schedule items → editor rows: a heading row wherever the day changes. */
function scheduleRows(items: SectionValues['schedule']): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let day: string | null = null;
  for (const i of items ?? []) {
    if (i.day && i.day !== day)
      rows.push({ key: nextKey(), heading: true, time: '', title: i.day, detail: '' });
    day = i.day;
    rows.push({ key: nextKey(), heading: false, time: i.time ?? '', title: i.title, detail: i.detail ?? '' });
  }
  return rows;
}

/** Editor rows → stored items (blank rows dropped; a heading applies to the rows below it). */
function scheduleItems(rows: readonly ScheduleRow[]) {
  let day: string | null = null;
  const items: { time: string | null; title: string; detail: string | null; day: string | null }[] = [];
  for (const r of rows) {
    if (r.heading) {
      day = r.title.trim() || null;
      continue;
    }
    if (!r.title.trim()) continue;
    items.push({ time: r.time || null, title: r.title.trim(), detail: r.detail.trim() || null, day });
  }
  return items;
}

const iconButton =
  'inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-focus';

function move<T>(rows: readonly T[], i: number, by: number): T[] {
  const to = i + by;
  if (to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  const [item] = next.splice(i, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Move up / move down / remove for one editor row. */
function RowTools({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  count: number;
  onMove: (by: number) => void;
  onRemove: () => void;
  label: string;
}) {
  const t = useTranslations('content.editor');
  return (
    <div className="flex gap-1">
      <button
        type="button"
        className={iconButton}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={t('rowUp', { label })}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        className={iconButton}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={t('rowDown', { label })}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} onClick={onRemove} aria-label={t('rowRemove', { label })}>
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/** Add a section (kind chosen here) or edit one (kind fixed), with a live preview beside it. */
export function SectionForm({
  action,
  kind: fixedKind,
  values,
  idPrefix,
  org,
  maxVideoBytes,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  kind?: SectionKind;
  values?: SectionValues;
  idPrefix: string;
  /** The organization's slug and the upload limit: with them a video section can upload a file. */
  org?: string;
  maxVideoBytes?: number;
}) {
  const t = useTranslations('content');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [kind, setKind] = useState<SectionKind>(fixedKind ?? 'text');
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (state.ok && !fixedKind) setEpoch((e) => e + 1);
  }, [state, fixedKind]);
  const bad = new Set(state.fields ?? []);
  const contentError = bad.has('content')
    ? state.reason && state.line
      ? t(`textErrors.${state.reason as 'schedule_time'}`, { line: state.line })
      : t('contentInvalid')
    : undefined;

  const [title, setTitle] = useState(values?.title ?? '');
  const [markdown, setMarkdown] = useState(values?.fields.markdown ?? '');
  const [address, setAddress] = useState(values?.fields.address ?? '');
  const [directions, setDirections] = useState(values?.fields.directions ?? '');
  const [mapUrl, setMapUrl] = useState(values?.fields.mapUrl ?? '');
  const [schedule, setSchedule] = useState<ScheduleRow[]>(() => scheduleRows(values?.schedule));
  const [faq, setFaq] = useState<FaqRow[]>(() =>
    (values?.faq ?? []).map((q) => ({ key: nextKey(), question: q.question, answer: q.answer })),
  );
  const [links, setLinks] = useState<LinkRow[]>(() =>
    (values?.links ?? []).map((l) => ({ key: nextKey(), label: l.label, url: l.url })),
  );
  const [videoUrl, setVideoUrl] = useState(values?.video?.url ?? '');
  const [videoPoster, setVideoPoster] = useState<string | null>(values?.video?.poster ?? null);
  const [videoCaption, setVideoCaption] = useState(values?.video?.caption ?? '');

  // The list kinds start with one empty row so there is something to type into.
  const rowsOf = {
    schedule: schedule.length,
    faq: faq.length,
    links: links.length,
  };
  useEffect(() => {
    if (kind === 'schedule' && rowsOf.schedule === 0)
      setSchedule([{ key: nextKey(), heading: false, time: '', title: '', detail: '' }]);
    if (kind === 'faq' && rowsOf.faq === 0) setFaq([{ key: nextKey(), question: '', answer: '' }]);
    if (kind === 'links' && rowsOf.links === 0) setLinks([{ key: nextKey(), label: '', url: '' }]);
  }, [kind, rowsOf.schedule, rowsOf.faq, rowsOf.links]);

  // What goes to the server for the list kinds, and what the preview shows.
  const scheduleOut = scheduleItems(schedule);
  const faqOut = faq
    .filter((r) => r.question.trim() || r.answer.trim())
    .map((r) => ({ question: r.question.trim(), answer: r.answer.trim() }));
  const linksOut = links
    .filter((r) => r.label.trim() || r.url.trim())
    .map((r) => ({ label: r.label.trim(), url: r.url.trim() }));
  const payload =
    kind === 'schedule'
      ? { items: scheduleOut }
      : kind === 'faq'
        ? { items: faqOut }
        : kind === 'links'
          ? { items: linksOut }
          : kind === 'video'
            ? { url: videoUrl.trim(), poster: videoPoster, caption: videoCaption.trim() || null }
            : null;

  const preview: SectionBody | null =
    kind === 'text'
      ? { kind, content: { markdown } }
      : kind === 'faq'
        ? { kind, content: { items: faqOut } }
        : kind === 'schedule'
          ? { kind, content: { items: scheduleOut } }
          : kind === 'links'
            ? { kind, content: { items: linksOut.map((l) => ({ ...l })) } }
            : kind === 'location'
              ? { kind, content: { address, directions, mapUrl: mapUrl.trim() || null } }
              : kind === 'video'
                ? {
                    kind,
                    content: {
                      url: videoUrl.trim(),
                      poster: videoPoster,
                      caption: videoCaption.trim() || null,
                    },
                  }
                : null;
  const previewEmpty =
    !preview ||
    (preview.kind === 'text' && !markdown.trim()) ||
    ('items' in preview.content && preview.content.items.length === 0) ||
    (preview.kind === 'location' && !address.trim() && !directions.trim() && !mapUrl.trim()) ||
    // A video previews once its link is a YouTube/Vimeo one or a file was uploaded.
    (preview.kind === 'video' && !isUploadedVideo(videoUrl.trim()) && !parseVideoUrl(videoUrl.trim()));

  const errorId = `${idPrefix}-content-error`;
  const markdownField = (
    name: string,
    label: string,
    value: string,
    set: (v: string) => void,
    rows: number,
    withError: boolean,
  ) => (
    <MarkdownField
      id={`${idPrefix}-${name}`}
      name={name}
      label={label}
      hint={t('hints.markdown')}
      value={value}
      onValueChange={set}
      rows={rows}
      invalid={withError && Boolean(contentError)}
      describedBy={withError && contentError ? errorId : undefined}
      maxLength={10_000}
    />
  );

  const inputClass = 'field';
  const addButton = (label: string, onClick: () => void, icon: ReactNode = <Plus className="size-4" />) => (
    <Button type="button" variant="secondary" onClick={onClick} className="self-start">
      {icon}
      {label}
    </Button>
  );

  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <div key={epoch} className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {fixedKind ? null : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-kind`} className="text-[13px] font-bold text-ink">
                {t('kind')}
              </label>
              <Select
                id={`${idPrefix}-kind`}
                name="kind"
                value={kind}
                onValueChange={(v) => setKind(v as SectionKind)}
                className="field"
              >
                {SECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Input
            id={`${idPrefix}-title`}
            name="title"
            required
            maxLength={120}
            label={t('sectionTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={bad.has('title') ? t('titleInvalid') : undefined}
          />
          {payload ? <input type="hidden" name="payload" value={JSON.stringify(payload)} /> : null}

          {kind === 'text'
            ? markdownField('markdown', t('fields.markdown'), markdown, setMarkdown, 8, true)
            : null}

          {kind === 'faq' ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="pb-1.5 text-[13px] font-bold text-ink">{t('fields.faq')}</legend>
              {faq.map((row, i) => (
                <div
                  key={row.key}
                  className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-3"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        id={`${idPrefix}-q-${row.key}`}
                        label={t('editor.question', { n: i + 1 })}
                        maxLength={300}
                        value={row.question}
                        onChange={(e) =>
                          setFaq((p) =>
                            p.map((r) => (r.key === row.key ? { ...r, question: e.target.value } : r)),
                          )
                        }
                      />
                    </div>
                    <RowTools
                      index={i}
                      count={faq.length}
                      label={t('editor.question', { n: i + 1 })}
                      onMove={(by) => setFaq((p) => move(p, i, by))}
                      onRemove={() => setFaq((p) => p.filter((r) => r.key !== row.key))}
                    />
                  </div>
                  <MarkdownField
                    id={`${idPrefix}-a-${row.key}`}
                    label={t('editor.answer')}
                    value={row.answer}
                    rows={3}
                    maxLength={4000}
                    onValueChange={(v) =>
                      setFaq((p) => p.map((r) => (r.key === row.key ? { ...r, answer: v } : r)))
                    }
                  />
                </div>
              ))}
              {addButton(t('editor.addQuestion'), () =>
                setFaq((p) => [...p, { key: nextKey(), question: '', answer: '' }]),
              )}
            </fieldset>
          ) : null}

          {kind === 'schedule' ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="pb-1.5 text-[13px] font-bold text-ink">{t('fields.schedule')}</legend>
              <p className="m-0 text-caption text-ink-2">{t('editor.scheduleHint')}</p>
              {schedule.map((row, i) => {
                const label = row.heading ? t('editor.dayN', { n: i + 1 }) : t('editor.itemN', { n: i + 1 });
                const set = (patch: Partial<ScheduleRow>) =>
                  setSchedule((p) => p.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
                return (
                  <div
                    key={row.key}
                    className={`flex flex-col gap-3 rounded-card border p-3 ${row.heading ? 'border-primary-ink bg-surface' : 'border-line bg-surface-2'}`}
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      {row.heading ? (
                        <div className="min-w-0 flex-1">
                          <Input
                            id={`${idPrefix}-s-${row.key}`}
                            label={t('editor.dayHeading')}
                            placeholder={t('editor.dayPlaceholder')}
                            maxLength={120}
                            value={row.title}
                            onChange={(e) => set({ title: e.target.value })}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="w-32">
                            <Input
                              id={`${idPrefix}-s-${row.key}`}
                              type="time"
                              label={t('editor.time')}
                              value={row.time}
                              onChange={(e) => set({ time: e.target.value })}
                            />
                          </div>
                          <div className="min-w-48 flex-1">
                            <Input
                              label={t('editor.itemTitle')}
                              maxLength={200}
                              value={row.title}
                              onChange={(e) => set({ title: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                      <RowTools
                        index={i}
                        count={schedule.length}
                        label={label}
                        onMove={(by) => setSchedule((p) => move(p, i, by))}
                        onRemove={() => setSchedule((p) => p.filter((r) => r.key !== row.key))}
                      />
                    </div>
                    {row.heading ? null : (
                      <Input
                        label={t('editor.detail')}
                        maxLength={500}
                        value={row.detail}
                        onChange={(e) => set({ detail: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                {addButton(t('editor.addItem'), () =>
                  setSchedule((p) => [
                    ...p,
                    { key: nextKey(), heading: false, time: '', title: '', detail: '' },
                  ]),
                )}
                {addButton(
                  t('editor.addDay'),
                  () =>
                    setSchedule((p) => [
                      ...p,
                      { key: nextKey(), heading: true, time: '', title: '', detail: '' },
                    ]),
                  <CalendarDays className="size-4" />,
                )}
              </div>
            </fieldset>
          ) : null}

          {kind === 'links' ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="pb-1.5 text-[13px] font-bold text-ink">{t('fields.links')}</legend>
              {links.map((row, i) => (
                <div
                  key={row.key}
                  className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface-2 p-3"
                >
                  <div className="min-w-40 flex-1">
                    <Input
                      id={`${idPrefix}-l-${row.key}`}
                      label={t('editor.linkLabel')}
                      maxLength={120}
                      value={row.label}
                      onChange={(e) =>
                        setLinks((p) =>
                          p.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r)),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-48 flex-[2]">
                    <Input
                      type="url"
                      label={t('editor.linkUrl')}
                      placeholder={t('editor.httpsPlaceholder')}
                      maxLength={500}
                      value={row.url}
                      onChange={(e) =>
                        setLinks((p) => p.map((r) => (r.key === row.key ? { ...r, url: e.target.value } : r)))
                      }
                    />
                  </div>
                  <RowTools
                    index={i}
                    count={links.length}
                    label={t('editor.linkN', { n: i + 1 })}
                    onMove={(by) => setLinks((p) => move(p, i, by))}
                    onRemove={() => setLinks((p) => p.filter((r) => r.key !== row.key))}
                  />
                </div>
              ))}
              {addButton(t('editor.addLink'), () =>
                setLinks((p) => [...p, { key: nextKey(), label: '', url: '' }]),
              )}
            </fieldset>
          ) : null}

          {kind === 'video' ? (
            <>
              {org && maxVideoBytes ? (
                <VideoField
                  name={`${idPrefix}-video`}
                  org={org}
                  initial={{ url: values?.video?.url ?? null, poster: values?.video?.poster ?? null }}
                  maxBytes={maxVideoBytes}
                  label={t('fields.videoUrl')}
                  hint={t('hints.videoUrl')}
                  linkPlaceholder={t('hints.videoPlaceholder')}
                  onChange={(v) => {
                    setVideoUrl(v.url ?? '');
                    setVideoPoster(v.poster);
                  }}
                />
              ) : (
                <Input
                  id={`${idPrefix}-videoUrl`}
                  type="url"
                  label={t('fields.videoUrl')}
                  hint={t('hints.videoUrl')}
                  placeholder={t('hints.videoPlaceholder')}
                  maxLength={500}
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  error={contentError}
                />
              )}
              <Input
                id={`${idPrefix}-videoCaption`}
                label={t('fields.videoCaption')}
                maxLength={200}
                value={videoCaption}
                onChange={(e) => setVideoCaption(e.target.value)}
              />
            </>
          ) : null}

          {kind === 'location' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-address`} className="text-[13px] font-bold text-ink">
                  {t('fields.address')}
                </label>
                <textarea
                  id={`${idPrefix}-address`}
                  name="address"
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`rounded-card border bg-surface px-4 py-2 text-body ${inputClass === 'field' && contentError ? 'field-invalid' : ''}`}
                />
                <p className="m-0 text-caption text-ink-2">{t('hints.address')}</p>
              </div>
              {markdownField('directions', t('fields.directions'), directions, setDirections, 4, false)}
              <Input
                id={`${idPrefix}-mapUrl`}
                name="mapUrl"
                type="url"
                label={t('fields.mapUrl')}
                value={mapUrl}
                onChange={(e) => setMapUrl(e.target.value)}
                error={contentError}
              />
            </>
          ) : null}

          {contentError && kind !== 'location' && kind !== 'video' ? (
            <p id={errorId} className="m-0 text-caption text-danger">
              {contentError}
            </p>
          ) : null}
        </div>

        <aside
          aria-label={t('editor.preview')}
          className="flex min-w-0 flex-col gap-3 rounded-panel border border-dashed border-line p-4 xl:sticky xl:top-4 xl:self-start"
        >
          <p className="m-0 text-label font-bold uppercase tracking-wide text-ink-2">{t('editor.preview')}</p>
          <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card">
            <h3 className="m-0 text-section">{title || t('editor.untitled')}</h3>
            {previewEmpty ? (
              <p className="m-0 text-body text-ink-2">{t('editor.previewEmpty')}</p>
            ) : preview ? (
              <SectionBodyView section={preview} openMap={t('openMap')} title={title} />
            ) : null}
          </div>
        </aside>
      </div>
      {fixedKind ? (
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input
            type="checkbox"
            name="visible"
            value="1"
            defaultChecked={values?.visible ?? true}
            className="size-5"
          />
          {t('visible')}
        </label>
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? (
          <Alert tone="info" title={fixedKind ? t('sectionSaved') : t('sectionAdded')} />
        ) : null}
        {state.code && !contentError && !bad.has('title') ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {fixedKind ? t('saveSection') : t('addSection')}
      </Button>
    </form>
  );
}
