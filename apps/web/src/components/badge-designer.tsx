'use client';

import {
  BADGE_SIZES,
  type BadgeDesign,
  BadgeElement,
  type BadgeSize,
  clampBox,
  ELEMENT_KINDS,
  type ElementKind,
  facesOf,
  layoutWarnings,
  MAX_ELEMENTS_PER_FACE,
  moveBox,
  PT_PER_MM,
  type ResolvedElement,
  RIBBON_COLOR_KEYS,
  type RibbonColor,
  rescaleDesign,
  resizeBox,
  resolveBadge,
  SIZES,
  sampleRows,
  TEXT_KINDS,
} from '@yayatoh/badges/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

/** Screen pixels per millimetre in the designer (a 4 in badge is ~305 px: fits a phone). */
const SCALE = 3;
const px = (mm: number) => `${Math.round(mm * SCALE * 10) / 10}px`;
const control = 'field';

export type SaveBadgeResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly code: string; readonly reason?: string };

interface Props {
  readonly template: { id: string; name: string; version: number; design: BadgeDesign };
  readonly ticketTypes: readonly { id: string; name: string }[];
  readonly questions: readonly { key: string; label: string }[];
  readonly canWrite: boolean;
  /** The sample QR (a code no scanner accepts), drawn on the server. */
  readonly sampleQr: { readonly size: number; readonly d: string };
  readonly save: (input: {
    name: string;
    design: BadgeDesign;
    baseVersion: number;
  }) => Promise<SaveBadgeResult>;
}

/** Positions and colours through the CSSOM (the strict CSP refuses style attributes). */
function usePlaced<T extends HTMLElement>(style: Partial<CSSStyleDeclaration>) {
  const ref = useRef<T>(null);
  const key = JSON.stringify(style);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    Object.assign(el.style, style);
  }, [key]);
  return ref;
}

function Guide({
  box,
  kind,
}: {
  box: { x: number; y: number; w: number; h: number };
  kind: 'safe' | 'bleed';
}) {
  const ref = usePlaced<HTMLDivElement>({
    left: px(box.x),
    top: px(box.y),
    width: px(box.w),
    height: px(box.h),
  });
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute border border-dashed ${kind === 'safe' ? 'border-success' : 'border-danger'}`}
    />
  );
}

/**
 * One element on the preview: a pointer target only (drag to move). Keyboard and assistive
 * technology use the element list next to it, which has the same selection.
 */
function PreviewElement({
  el,
  selected,
  qr,
  canMove,
  onSelect,
  onDrag,
}: {
  el: ResolvedElement;
  selected: boolean;
  qr: Props['sampleQr'];
  canMove: boolean;
  onSelect: () => void;
  onDrag: (dxMm: number, dyMm: number) => void;
}) {
  const ref = usePlaced<HTMLDivElement>({
    left: px(el.x),
    top: px(el.y),
    width: px(el.w),
    height: px(el.h),
    fontSize: `${Math.round((el.fontPt / PT_PER_MM) * SCALE * 10) / 10}px`,
    fontWeight: el.bold ? '700' : '400',
    justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center',
    background: el.fill ?? 'transparent',
    color: el.color ?? '',
  });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    onSelect();
    if (!canMove) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>, done = false) => {
    const start = drag.current;
    if (!start) return;
    const dx = (e.clientX - start.x) / SCALE;
    const dy = (e.clientY - start.y) / SCALE;
    if (done) drag.current = null;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
      if (!done) drag.current = { x: e.clientX, y: e.clientY };
      onDrag(Math.round(dx * 2) / 2, Math.round(dy * 2) / 2);
    }
  };
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-element={el.id}
      onPointerDown={down}
      onPointerMove={(e) => move(e)}
      onPointerUp={(e) => move(e, true)}
      className={`absolute flex touch-none items-center overflow-hidden whitespace-nowrap leading-tight outline-offset-1 ${
        canMove ? 'cursor-move' : 'cursor-pointer'
      } ${selected ? 'outline-2 outline-primary' : 'outline-1 outline-line-strong outline-dashed'} ${
        el.empty ? 'opacity-40' : ''
      }`}
    >
      {el.kind === 'qr' ? (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          shapeRendering="crispEdges"
          className="size-full bg-white fill-ink"
        >
          <path d={qr.d} />
        </svg>
      ) : el.kind === 'logo' ? null : (
        <span dir="auto" className="max-w-full overflow-hidden text-ellipsis">
          {el.text}
        </span>
      )}
    </div>
  );
}

function Face({ size, children }: { size: BadgeSize; children: React.ReactNode }) {
  const s = SIZES[size];
  const ref = usePlaced<HTMLDivElement>({ width: px(s.widthMm), height: px(s.heightMm) });
  return (
    // A printed badge is always on white stock: the light theme inside the preview (ADR 0022).
    <div
      ref={ref}
      dir="ltr"
      data-theme="light"
      className="relative shrink-0 bg-white text-ink elevation-card ring-1 ring-line"
    >
      {children}
    </div>
  );
}

let counter = 0;
const newId = (kind: ElementKind, taken: Set<string>) => {
  let id: string;
  do {
    counter += 1;
    id = `${kind.replace('_', '-').slice(0, 12)}-${counter}`;
  } while (taken.has(id));
  return id;
};

/**
 * The badge template designer (M5.5a). Every drag has a keyboard and form alternative: select an
 * element (click, tap, or Tab to it), then move it with the arrow keys (Shift: 5 mm) and resize it
 * with Alt + arrows, or type its position and size in millimetres. The preview shows sample people
 * in English or Arabic (mirrored, shaped by the browser), exactly as the PDF lays them out.
 */
export function BadgeDesigner({ template, ticketTypes, questions, canWrite, sampleQr, save }: Props) {
  const t = useTranslations('badges');
  const te = useTranslations();
  const uid = useId();
  const [name, setName] = useState(template.name);
  const [design, setDesign] = useState<BadgeDesign>(template.design);
  const [version, setVersion] = useState(template.version);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [selected, setSelected] = useState<string | null>(template.design.front[0]?.id ?? null);
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [addKind, setAddKind] = useState<ElementKind>('text');
  const [result, setResult] = useState<SaveBadgeResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const faces = facesOf(design.size);
  const shownFace = faces.includes(face) ? face : 'front';
  const mirrored = lang === 'ar';
  const shown: BadgeDesign = mirrored ? { ...design, direction: 'rtl' } : design;
  const rows = useMemo(() => sampleRows(shown, lang), [shown, lang]);
  const resolved = useMemo(() => {
    const row = rows[0];
    return row ? resolveBadge(shown, row, false).filter((e) => e.face === shownFace) : [];
  }, [shown, rows, shownFace]);
  const elements = design[shownFace];
  const current = elements.find((e) => e.id === selected) ?? null;
  const warnings = new Set(layoutWarnings(design));
  const s = SIZES[design.size];

  const update = (next: BadgeDesign) => {
    setDesign(next);
    setDirty(true);
    setResult(null);
  };
  const patch = (id: string, change: Partial<BadgeElement>) =>
    update({
      ...design,
      [shownFace]: design[shownFace].map((e) => (e.id === id ? BadgeElement.parse({ ...e, ...change }) : e)),
    });
  const moveBy = (id: string, dx: number, dy: number) => {
    const el = design[shownFace].find((e) => e.id === id);
    // In the Arabic (mirrored) preview, "right" on screen is "towards the start" in the design.
    if (el) patch(id, moveBox(el, mirrored ? -dx : dx, dy, design.size));
  };
  const resizeBy = (id: string, dw: number, dh: number) => {
    const el = design[shownFace].find((e) => e.id === id);
    if (el) patch(id, resizeBox(el, dw, dh, design.size));
  };
  const onKey = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    setSelected(id);
    if (!canWrite) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.altKey) resizeBy(id, d[0] * step, d[1] * step);
    else moveBy(id, d[0] * step, d[1] * step);
  };
  const kindLabel = (k: ElementKind) => t(`kinds.${k}`);
  const describe = (el: ResolvedElement) =>
    t('elementLabel', {
      kind: kindLabel(el.kind),
      text: el.text || '—',
      x: design[shownFace].find((e) => e.id === el.id)?.x ?? 0,
      y: el.y,
    });

  const add = () => {
    const taken = new Set([...design.front, ...design.back].map((e) => e.id));
    const w = Math.min(40, s.widthMm - 2 * s.safeMm);
    const h = addKind === 'qr' || addKind === 'logo' ? Math.min(20, s.heightMm / 3) : 8;
    const el = BadgeElement.parse({
      id: newId(addKind, taken),
      kind: addKind,
      ...clampBox({ x: (s.widthMm - w) / 2, y: (s.heightMm - h) / 2, w, h }, design.size),
      fontSizePt: 12,
      text: addKind === 'text' ? t('newText') : '',
    });
    update({ ...design, [shownFace]: [...design[shownFace], el] });
    setSelected(el.id);
  };
  const remove = (id: string) => {
    update({ ...design, [shownFace]: design[shownFace].filter((e) => e.id !== id) });
    setSelected(null);
  };
  const setRibbon = (typeId: string, change: { label?: string; color?: RibbonColor | '' }) => {
    const prev = design.ribbons[typeId];
    const color = change.color === undefined ? prev?.color : change.color;
    const ribbons = { ...design.ribbons };
    // A half-typed (empty) label stays while editing; empty ribbons are dropped on save.
    if (!color) delete ribbons[typeId];
    else ribbons[typeId] = { label: (change.label ?? prev?.label ?? '').slice(0, 40), color };
    update({ ...design, ribbons });
  };
  const onSave = () =>
    startTransition(async () => {
      const clean: BadgeDesign = {
        ...design,
        ribbons: Object.fromEntries(Object.entries(design.ribbons).filter(([, r]) => r.label.trim())),
      };
      const r = await save({ name, design: clean, baseVersion: version });
      setResult(r);
      if (r.ok) {
        setVersion(r.version);
        setDirty(false);
      }
    });

  const num = (
    key: string,
    label: string,
    value: number,
    onChange: (v: number) => void,
    opts: { step?: number; min?: number; max?: number } = {},
  ) => (
    <Input
      id={`${uid}-${key}`}
      label={label}
      type="number"
      inputMode="decimal"
      step={opts.step ?? 0.5}
      min={opts.min}
      max={opts.max}
      value={String(value)}
      disabled={!canWrite}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v) && e.currentTarget.value !== '') onChange(v);
      }}
    />
  );

  const isText = current ? TEXT_KINDS.includes(current.kind) : false;
  const errorText =
    result && !result.ok
      ? result.reason === 'stale_version'
        ? t('errors.stale')
        : result.reason === 'question_not_allowed'
          ? t('errors.questionNotAllowed')
          : result.code === 'conflict'
            ? t('errors.nameTaken')
            : te(errorMessageKey(result.code))
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Input
          id={`${uid}-name`}
          label={t('templateName')}
          value={name}
          maxLength={80}
          required
          disabled={!canWrite}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setDirty(true);
          }}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-size`} className="text-[13px] font-bold text-ink">
            {t('size')}
          </label>
          <select
            id={`${uid}-size`}
            className={control}
            value={design.size}
            disabled={!canWrite}
            aria-describedby={`${uid}-size-hint`}
            onChange={(e) => {
              update(rescaleDesign(design, e.currentTarget.value as BadgeSize));
              setFace('front');
            }}
          >
            {BADGE_SIZES.map((k) => (
              <option key={k} value={k}>
                {t(`sizes.${k}`)}
              </option>
            ))}
          </select>
          <p id={`${uid}-size-hint`} className="text-caption text-ink-2">
            {t('sizeHint', { bleed: s.bleedMm, safe: s.safeMm })}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-dir`} className="text-[13px] font-bold text-ink">
            {t('direction')}
          </label>
          <select
            id={`${uid}-dir`}
            className={control}
            value={design.direction}
            disabled={!canWrite}
            onChange={(e) => update({ ...design, direction: e.currentTarget.value as 'ltr' | 'rtl' })}
          >
            <option value="ltr">{t('directionLtr')}</option>
            <option value="rtl">{t('directionRtl')}</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-caption text-ink-2">{t('previewIn')}</legend>
          <div className="flex gap-4">
            {(['en', 'ar'] as const).map((l) => (
              <label key={l} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name={`${uid}-lang`}
                  value={l}
                  checked={lang === l}
                  onChange={() => setLang(l)}
                  className="size-5"
                />
                {t(l === 'en' ? 'previewEnglish' : 'previewArabic')}
              </label>
            ))}
          </div>
        </fieldset>
        {faces.length > 1 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-caption text-ink-2">{t('side')}</legend>
            <div className="flex gap-4">
              {faces.map((f) => (
                <label key={f} className="flex min-h-6 items-center gap-2 text-body">
                  <input
                    type="radio"
                    name={`${uid}-face`}
                    value={f}
                    checked={shownFace === f}
                    onChange={() => {
                      setFace(f);
                      setSelected(design[f][0]?.id ?? null);
                    }}
                    className="size-5"
                  />
                  {t(f === 'front' ? 'front' : 'back')}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section aria-labelledby={`${uid}-preview`} className="flex flex-col gap-2">
          <h2 id={`${uid}-preview`} className="text-section">
            {t('preview', { side: t(shownFace === 'front' ? 'front' : 'back') })}
          </h2>
          <p id={`${uid}-keys`} className="max-w-prose text-caption text-ink-2">
            {canWrite ? t('keyboardHint') : t('selectHint')}
          </p>
          <div className="max-w-full overflow-x-auto p-1">
            <Face size={design.size}>
              {s.bleedMm > 0 ? (
                <Guide kind="bleed" box={{ x: 0, y: 0, w: s.widthMm, h: s.heightMm }} />
              ) : null}
              <Guide
                kind="safe"
                box={{ x: s.safeMm, y: s.safeMm, w: s.widthMm - 2 * s.safeMm, h: s.heightMm - 2 * s.safeMm }}
              />
              {resolved.map((el) => (
                <PreviewElement
                  key={el.id}
                  el={el}
                  qr={sampleQr}
                  selected={el.id === selected}
                  canMove={canWrite}
                  onSelect={() => setSelected(el.id)}
                  onDrag={(dx, dy) => moveBy(el.id, dx, dy)}
                />
              ))}
            </Face>
          </div>
          <p className="text-caption text-ink-2">{t('guidesHint')}</p>
          <h3 id={`${uid}-list`} className="text-body font-medium">
            {t('elements')}
          </h3>
          <ul aria-labelledby={`${uid}-list`} className="flex list-none flex-col gap-1.5 p-0">
            {resolved.map((el) => (
              <li key={el.id}>
                <button
                  type="button"
                  aria-pressed={el.id === selected}
                  aria-describedby={`${uid}-keys`}
                  onClick={() => setSelected(el.id)}
                  onKeyDown={onKey(el.id)}
                  className={`min-h-10 w-full rounded-pill border px-4 text-start text-body ${
                    el.id === selected
                      ? 'border-primary bg-primary-soft'
                      : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  {describe(el)}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {canWrite ? (
          <section aria-labelledby={`${uid}-element`} className="flex min-w-0 flex-1 flex-col gap-4">
            <h2 id={`${uid}-element`} className="text-section">
              {current ? t('selected', { kind: kindLabel(current.kind) }) : t('nothingSelected')}
            </h2>
            {current ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  {num('x', t('x'), current.x, (v) =>
                    patch(current.id, clampBox({ ...current, x: v }, design.size)),
                  )}
                  {num('y', t('y'), current.y, (v) =>
                    patch(current.id, clampBox({ ...current, y: v }, design.size)),
                  )}
                  {num(
                    'width',
                    t('width'),
                    current.w,
                    (v) => patch(current.id, clampBox({ ...current, w: v }, design.size)),
                    { min: 2 },
                  )}
                  {num(
                    'height',
                    t('height'),
                    current.h,
                    (v) => patch(current.id, clampBox({ ...current, h: v }, design.size)),
                    { min: 2 },
                  )}
                </div>
                {isText ? (
                  <>
                    {num(
                      'fontSize',
                      t('fontSize'),
                      current.fontSizePt,
                      (v) => patch(current.id, { fontSizePt: Math.min(96, Math.max(6, v)) }),
                      {
                        min: 6,
                        max: 96,
                      },
                    )}
                    <label className="flex min-h-6 items-center gap-2 text-body">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={current.fit}
                        onChange={(e) => patch(current.id, { fit: e.currentTarget.checked })}
                      />
                      {t('fit')}
                    </label>
                    <label className="flex min-h-6 items-center gap-2 text-body">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={current.bold}
                        onChange={(e) => patch(current.id, { bold: e.currentTarget.checked })}
                      />
                      {t('bold')}
                    </label>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${uid}-align`} className="text-[13px] font-bold text-ink">
                        {t('align')}
                      </label>
                      <select
                        id={`${uid}-align`}
                        className={control}
                        value={current.align}
                        onChange={(e) =>
                          patch(current.id, { align: e.currentTarget.value as BadgeElement['align'] })
                        }
                      >
                        <option value="start">{t('alignStart')}</option>
                        <option value="center">{t('alignCenter')}</option>
                        <option value="end">{t('alignEnd')}</option>
                      </select>
                    </div>
                  </>
                ) : null}
                {current.kind === 'text' ? (
                  <Input
                    id={`${uid}-text`}
                    label={t('freeText')}
                    value={current.text}
                    maxLength={120}
                    onChange={(e) => patch(current.id, { text: e.currentTarget.value })}
                  />
                ) : null}
                {warnings.has(current.id) ? <Alert tone="info" title={t('outsideSafe')} /> : null}
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(current.id)}>
                    {t('remove', { kind: kindLabel(current.kind) })}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-caption text-ink-2">{t('selectHint')}</p>
            )}
            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-add`} className="text-[13px] font-bold text-ink">
                  {t('addKind')}
                </label>
                <select
                  id={`${uid}-add`}
                  className={control}
                  value={addKind}
                  onChange={(e) => setAddKind(e.currentTarget.value as ElementKind)}
                >
                  {ELEMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={elements.length >= MAX_ELEMENTS_PER_FACE}
                onClick={add}
              >
                {t('add')}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      {canWrite ? (
        <>
          <section aria-labelledby={`${uid}-ribbons`} className="flex flex-col gap-3">
            <h2 id={`${uid}-ribbons`} className="text-section">
              {t('ribbons')}
            </h2>
            <p className="text-caption text-ink-2">{t('ribbonsHint')}</p>
            {ticketTypes.length === 0 ? (
              <p className="text-body text-ink-2">{t('noTicketTypes')}</p>
            ) : (
              <ul className="flex list-none flex-col gap-3 p-0">
                {ticketTypes.map((tt) => {
                  const r = design.ribbons[tt.id];
                  return (
                    <li key={tt.id} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${uid}-rc-${tt.id}`} className="text-[13px] font-bold text-ink">
                          {t('ribbonColor', { type: tt.name })}
                        </label>
                        <select
                          id={`${uid}-rc-${tt.id}`}
                          className={control}
                          value={r?.color ?? ''}
                          onChange={(e) =>
                            setRibbon(tt.id, {
                              color: e.currentTarget.value as RibbonColor | '',
                              label: r?.label || tt.name.toUpperCase().slice(0, 40),
                            })
                          }
                        >
                          <option value="">{t('noRibbon')}</option>
                          {RIBBON_COLOR_KEYS.map((c) => (
                            <option key={c} value={c}>
                              {t(`colors.${c}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {r ? (
                        <Input
                          id={`${uid}-rl-${tt.id}`}
                          label={t('ribbonLabel', { type: tt.name })}
                          value={r.label}
                          maxLength={40}
                          onChange={(e) => setRibbon(tt.id, { label: e.currentTarget.value })}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${uid}-sources`} className="flex flex-col gap-3">
            <h2 id={`${uid}-sources`} className="text-section">
              {t('sources')}
            </h2>
            <p className="max-w-prose text-caption text-ink-2">{t('sourcesHint')}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(['company', 'jobTitle'] as const).map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <label htmlFor={`${uid}-src-${field}`} className="text-[13px] font-bold text-ink">
                    {t(field === 'company' ? 'companyFrom' : 'jobTitleFrom')}
                  </label>
                  <select
                    id={`${uid}-src-${field}`}
                    className={control}
                    value={design.sources[field] ?? ''}
                    onChange={(e) =>
                      update({
                        ...design,
                        sources: { ...design.sources, [field]: e.currentTarget.value || null },
                      })
                    }
                  >
                    <option value="">{t('notPrinted')}</option>
                    {questions.map((q) => (
                      <option key={q.key} value={q.key}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="button" onClick={onSave} disabled={pending || !name.trim()}>
              {t('save')}
            </Button>
            <span className="text-caption text-ink-2">
              {dirty ? t('unsaved') : t('version', { version })}
            </span>
          </div>
          <div aria-live="polite">
            {result?.ok ? <Alert tone="info" title={t('saved', { version: result.version })} /> : null}
            {errorText ? <Alert title={errorText} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
