'use client';

import {
  CALIBRATION_METRES,
  type CalibrationProblem,
  calibrationScale,
  currentScale,
  type FloorplanDoc,
  initialUnderlay,
  roomToImage,
  scaleUnderlay,
  UNDERLAY_OPACITY,
  type Underlay,
} from '@yayatoh/floorplan';
import { Alert, Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useId, useRef, useState } from 'react';
import { looksLikeImage, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from '@/lib/media-limits.ts';

const field = 'field w-24 px-3';
type Point = { x: string; y: string };
/** Upload refusals with their own message (anything else is `generic`). */
const UPLOAD_REASONS = new Set([
  'no_file',
  'unsupported_type',
  'too_large',
  'too_many_pixels',
  'undecodable',
  'quota_exceeded',
  'slot_full',
  'forbidden',
  'network',
]);
type Sized = Underlay & { imageWidth: number; imageHeight: number };
const sized = (u: Underlay | null): u is Sized => Boolean(u?.imageWidth && u.imageHeight);

/** Which calibration point the next click on the plan sets (null: clicks select as usual). */
export type Marking = 'a' | 'b' | null;

/**
 * The floor plan image under the plan (M1.7g): upload it (through the media pipeline: sniffed,
 * re-encoded, EXIF stripped, served from the org's own media), set its scale by two points and
 * the real distance between them, move it, fade it, lock it, and choose whether buyers see it
 * faintly under their map. Every canvas step has a form here: points are typed as pixels of the
 * image, or marked by clicking the plan ("Mark on the plan").
 */
export function UnderlayPanel({
  doc,
  commit,
  locked,
  ticket,
  marking,
  setMarking,
  points,
  setPoints,
}: {
  doc: FloorplanDoc;
  commit: (next: FloorplanDoc) => void;
  locked: boolean;
  /** Upload ticket for the event's floor plan images; null for people who can't change them. */
  ticket: string | null;
  marking: Marking;
  setMarking: (m: Marking) => void;
  points: { a: Point; b: Point };
  setPoints: (p: { a: Point; b: Point }) => void;
}) {
  const t = useTranslations('seatingUnderlay');
  const locale = useLocale();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [calError, setCalError] = useState<{ problem: CalibrationProblem | 'number'; field: string } | null>(
    null,
  );
  const [metres, setMetres] = useState('');
  const u = doc.underlay;
  const readOnly = locked || !ticket;
  const imageLocked = readOnly || Boolean(u?.locked);
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const set = (patch: Partial<Underlay>) => {
    if (u) commit({ ...doc, underlay: { ...u, ...patch } });
  };

  function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ticket) return;
    const file = fileRef.current?.files?.[0];
    const fail = (reason: string) => {
      setError(reason);
      setStatus('');
      fileRef.current?.focus();
    };
    if (!file) return fail('no_file');
    if (!looksLikeImage(file)) return fail('unsupported_type');
    if (file.size > UPLOAD_MAX_BYTES) return fail('too_large');
    setError(null);
    const body = new FormData();
    body.set('ticket', ticket);
    body.set('file', file);
    // A background, not content: the plan itself is described by its list.
    body.set('decorative', '1');
    body.set('locale', locale);
    setStatus(t('uploading'));
    fetch('/api/media/upload', { method: 'POST', body })
      .then(async (r) => {
        const res = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          reason?: string;
          code?: string;
          assetId?: string;
          url?: string;
          width?: number;
          height?: number;
        };
        if (!r.ok || !res.ok || !res.assetId || !res.url || !res.width || !res.height)
          return fail(res.reason ?? res.code ?? 'generic');
        commit({
          ...doc,
          underlay: initialUnderlay(
            { url: res.url, mediaId: res.assetId, width: res.width, height: res.height },
            doc,
          ),
        });
        if (fileRef.current) fileRef.current.value = '';
        setStatus(t('uploaded'));
      })
      .catch(() => fail('network'));
  }

  function calibrate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sized(u)) return;
    const n = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));
    const values = { ax: n(points.a.x), ay: n(points.a.y), bx: n(points.b.x), by: n(points.b.y) };
    const bad = Object.entries(values).find(([, v]) => !Number.isFinite(v));
    if (bad) return setCalError({ problem: 'number', field: bad[0] });
    const r = calibrationScale(
      { x: values.ax, y: values.ay },
      { x: values.bx, y: values.by },
      Number(metres),
      { width: u.imageWidth, height: u.imageHeight },
    );
    if (!r.ok)
      return setCalError({
        problem: r.problem,
        field:
          r.problem === 'distance_out_of_range' ? 'metres' : r.problem === 'points_too_close' ? 'bx' : 'ax',
      });
    setCalError(null);
    commit({ ...doc, underlay: scaleUnderlay(u, r.cmPerPixel) });
    setMarking(null);
    setStatus(t('calibrated', { scale: num.format(r.cmPerPixel) }));
  }

  const errorId = `${id}-cal-error`;
  const pointField = (which: 'a' | 'b', axis: 'x' | 'y') => {
    const key = `${which}${axis}`;
    return (
      <label className="flex flex-col gap-1 text-[13px] font-bold text-ink">
        {t(`point.${key}`)}
        <input
          id={`${id}-${key}`}
          type="number"
          inputMode="decimal"
          min={0}
          value={points[which][axis]}
          disabled={imageLocked}
          aria-invalid={calError?.field === key || undefined}
          aria-describedby={calError?.field === key ? errorId : undefined}
          onChange={(e) =>
            setPoints({ ...points, [which]: { ...points[which], [axis]: e.currentTarget.value } })
          }
          className={field}
        />
      </label>
    );
  };

  return (
    <section
      aria-labelledby={`${id}-h`}
      data-underlay={u?.url}
      className="flex flex-col gap-3 rounded-card border border-line p-4"
    >
      <h3 id={`${id}-h`} className="text-body font-medium">
        {t('title')}
      </h3>
      <p className="text-caption text-ink-2">{t('description')}</p>
      <p role="status" className="text-caption text-ink-2">
        {status}
      </p>

      {!readOnly ? (
        <form onSubmit={upload} className="flex flex-wrap items-end gap-3" noValidate>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-ink">
            {u ? t('replace') : t('file')}
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT.join(',')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-up-error` : `${id}-up-hint`}
              className="min-h-10 text-body"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t('upload')}
          </Button>
          <p id={`${id}-up-hint`} className="w-full text-caption text-ink-2">
            {t('fileHint')}
          </p>
          {error ? (
            <p id={`${id}-up-error`} className="w-full text-caption text-danger">
              {t(`errors.${UPLOAD_REASONS.has(error) ? error : 'generic'}`)}
            </p>
          ) : null}
        </form>
      ) : null}

      {u ? (
        <>
          <p className="text-body">
            {sized(u)
              ? t('scale', {
                  scale: num.format(currentScale(u)),
                  width: num.format(u.width / 100),
                  height: num.format(u.height / 100),
                })
              : t('size', { width: num.format(u.width / 100), height: num.format(u.height / 100) })}
          </p>

          {sized(u) ? (
            <form
              onSubmit={calibrate}
              className="flex flex-col gap-3"
              noValidate
              aria-labelledby={`${id}-cal`}
            >
              <h4 id={`${id}-cal`} className="text-caption font-medium text-ink-2">
                {t('calibrate')}
              </h4>
              <p className="text-caption text-ink-2">{t('calibrateHint')}</p>
              <div className="flex flex-wrap gap-3">
                {pointField('a', 'x')}
                {pointField('a', 'y')}
                {!imageLocked ? (
                  <Button
                    size="sm"
                    variant={marking === 'a' ? 'primary' : 'ghost'}
                    aria-pressed={marking === 'a'}
                    onClick={() => setMarking(marking === 'a' ? null : 'a')}
                    className="self-end"
                  >
                    {t('markA')}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {pointField('b', 'x')}
                {pointField('b', 'y')}
                {!imageLocked ? (
                  <Button
                    size="sm"
                    variant={marking === 'b' ? 'primary' : 'ghost'}
                    aria-pressed={marking === 'b'}
                    onClick={() => setMarking(marking === 'b' ? null : 'b')}
                    className="self-end"
                  >
                    {t('markB')}
                  </Button>
                ) : null}
              </div>
              {marking ? (
                <p role="status" className="text-caption font-medium text-ink">
                  {t(marking === 'a' ? 'markingA' : 'markingB')}
                </p>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[13px] font-bold text-ink">
                  {t('metres')}
                  <input
                    id={`${id}-metres`}
                    type="number"
                    inputMode="decimal"
                    min={CALIBRATION_METRES.min}
                    max={CALIBRATION_METRES.max}
                    step="any"
                    value={metres}
                    disabled={imageLocked}
                    aria-invalid={calError?.field === 'metres' || undefined}
                    aria-describedby={calError?.field === 'metres' ? errorId : undefined}
                    onChange={(e) => setMetres(e.currentTarget.value)}
                    className={field}
                  />
                </label>
                <Button type="submit" size="sm" disabled={imageLocked}>
                  {t('applyScale')}
                </Button>
              </div>
              {calError ? (
                <Alert title={<span id={errorId}>{t(`calErrors.${calError.problem}`)}</span>} />
              ) : null}
            </form>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            {(['x', 'y'] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-[13px] font-bold text-ink">
                {t(`position.${k}`)}
                <input
                  key={`${k}:${u[k]}`}
                  type="number"
                  step={10}
                  defaultValue={u[k]}
                  disabled={imageLocked}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.currentTarget.value));
                    if (Number.isFinite(v) && v !== u[k]) set({ [k]: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className={field}
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-[13px] font-bold text-ink">
              {t('opacity', { percent: Math.round(u.opacity * 100) })}
              <input
                type="range"
                min={UNDERLAY_OPACITY.min * 100}
                max={UNDERLAY_OPACITY.max * 100}
                step={5}
                defaultValue={Math.round(u.opacity * 100)}
                disabled={readOnly}
                aria-valuetext={`${Math.round(u.opacity * 100)} %`}
                onPointerUp={(e) => set({ opacity: Number(e.currentTarget.value) / 100 })}
                onKeyUp={(e) => set({ opacity: Number(e.currentTarget.value) / 100 })}
                className="min-h-6 w-40"
              />
            </label>
          </div>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-5"
              checked={u.locked}
              disabled={readOnly}
              onChange={(e) => set({ locked: e.currentTarget.checked })}
            />
            {t('lock')}
          </label>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-5"
              checked={u.showOnMap}
              disabled={readOnly}
              aria-describedby={`${id}-map-hint`}
              onChange={(e) => set({ showOnMap: e.currentTarget.checked })}
            />
            {t('showOnMap')}
          </label>
          <p id={`${id}-map-hint`} className="text-caption text-ink-2">
            {t('showOnMapHint')}
          </p>
          {!readOnly ? (
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={u.locked}
                onClick={() => {
                  commit({ ...doc, underlay: null });
                  setStatus(t('removed'));
                }}
              >
                {t('remove')}
              </Button>
            </div>
          ) : null}
        </>
      ) : readOnly ? (
        <p className="text-caption text-ink-2">{t('none')}</p>
      ) : null}
    </section>
  );
}

/** A click on the plan in room centimetres → the image pixel under it, as form text. */
export function pointFromPlan(u: Underlay | null, p: { x: number; y: number }): Point | null {
  if (!sized(u)) return null;
  const q = roomToImage(u, p);
  return { x: String(q.x), y: String(q.y) };
}

/** The calibration points as marks on the plan (room centimetres). */
export function planMarks(u: Underlay | null, points: { a: Point; b: Point }) {
  if (!sized(u)) return [];
  return (['a', 'b'] as const).flatMap((k) => {
    const x = Number(points[k].x);
    const y = Number(points[k].y);
    if (points[k].x === '' || points[k].y === '' || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [
      {
        label: k.toUpperCase(),
        x: Math.round(u.x + (x * u.width) / u.imageWidth),
        y: Math.round(u.y + (y * u.height) / u.imageHeight),
      },
    ];
  });
}
