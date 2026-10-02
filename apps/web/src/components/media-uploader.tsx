'use client';

import { Alert, Button, cx, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type DragEvent, type FormEvent, useActionState, useEffect, useId, useRef, useState } from 'react';
import { removeMediaAction, updateMediaAltAction } from '@/app/[locale]/o/[org]/media-actions.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import {
  formatMegabytes,
  GALLERY_MAX,
  looksLikeImage,
  UPLOAD_ACCEPT,
  UPLOAD_MAX_BYTES,
} from '@/lib/media-limits.ts';
import type { MediaItem } from '@/server/media.ts';

type Slot = 'cover' | 'gallery' | 'photo' | 'logo';
/** M1.4h: a program row's single image (speaker photo, exhibitor or sponsor logo). */
type ProgramKind = 'speaker' | 'exhibitor' | 'sponsor';
type Family = 'content' | 'logo' | ProgramKind;

/** Upload error reasons with their own message (anything else is `generic`). */
const REASONS = new Set([
  'no_file',
  'alt_required',
  'alt_missing',
  'unsupported_type',
  'too_large',
  'too_many_pixels',
  'undecodable',
  'svg_malformed',
  'svg_not_svg',
  'svg_too_complex',
  'quota_exceeded',
  'slot_full',
  'forbidden',
  'network',
]);

interface UploadError {
  readonly reason: string;
  readonly field: 'file' | 'alt' | null;
}

/**
 * The image uploader (M1.4e): a real file input (keyboard and screen readers; dropping a file
 * on the zone is optional sugar), alt text (required unless decorative), a progress bar and
 * live status, and per image: alt text editing, replace and remove.
 *
 * M1.4h: with `kind` it holds a speaker's photo or an exhibitor's/sponsor's logo — one image,
 * never decorative, the alt text prefilled with `defaultAlt` ("Photo of {name}", the company
 * name) for the organizer to edit.
 */
export function MediaUploader({
  org,
  slot,
  ticket,
  items,
  headingLevel = 2,
  kind,
  defaultAlt = '',
  title,
}: {
  org: string;
  slot: Slot;
  /** Signed by the server for people who may change these images; null hides every control. */
  ticket: string | null;
  items: readonly MediaItem[];
  headingLevel?: 2 | 3 | 4;
  kind?: ProgramKind;
  defaultAlt?: string;
  /** The section heading (default: the slot's title). */
  title?: string;
}) {
  const t = useTranslations('media');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const altRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [alt, setAlt] = useState(defaultAlt);
  const [decorative, setDecorative] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<UploadError | null>(null);
  const [dragging, setDragging] = useState(false);

  const family: Family = kind ?? (slot === 'logo' ? 'logo' : 'content');
  const multiple = !kind && (slot === 'gallery' || slot === 'photo');
  // Messages per slot, or per program kind (their photo/logo differ from venue photos and the org logo).
  const key = kind ?? slot;
  const altMissing = family === 'content' ? 'alt_required' : kind ? 'alt_missing' : 'alt_required';
  const full = multiple && items.length >= GALLERY_MAX && !replaceId;
  const size = formatMegabytes(UPLOAD_MAX_BYTES, locale);
  const Heading = headingLevel === 2 ? 'h2' : headingLevel === 3 ? 'h3' : 'h4';
  const replacing = replaceId ? items.find((i) => i.id === replaceId) : null;
  const nameOf = (i: MediaItem) => i.alt ?? t('decorativeName');
  const message = (e: UploadError) =>
    t(`errors.${REASONS.has(e.reason) ? e.reason : 'generic'}`, { size, max: GALLERY_MAX });

  function reset() {
    if (fileRef.current) fileRef.current.value = '';
    setFileName(null);
    setAlt(defaultAlt);
    setDecorative(false);
    setReplaceId(null);
  }

  function fail(reason: string, field: UploadError['field']) {
    setError({ reason, field });
    setStatus('');
    setProgress(null);
    if (field === 'alt') altRef.current?.focus();
    else if (field === 'file') fileRef.current?.focus();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ticket) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return fail('no_file', 'file');
    if (!looksLikeImage(file)) return fail('unsupported_type', 'file');
    if (file.size > UPLOAD_MAX_BYTES) return fail('too_large', 'file');
    if (!decorative && !alt.trim()) return fail(altMissing, 'alt');
    setError(null);
    const body = new FormData();
    body.set('ticket', ticket);
    body.set('file', file);
    body.set('alt', alt.trim());
    body.set('locale', locale);
    if (decorative) body.set('decorative', '1');
    if (replaceId) body.set('replaceAssetId', replaceId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.responseType = 'json';
    setProgress(0);
    setStatus(t('uploading', { percent: 0 }));
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
      setProgress(pct);
      setStatus(pct >= 99 ? t('processing') : t('uploading', { percent: pct }));
    };
    xhr.onload = () => {
      const res = (xhr.response ?? {}) as { ok?: boolean; code?: string; reason?: string; fields?: string[] };
      if (xhr.status === 200 && res.ok) {
        setProgress(100);
        setStatus(t('uploaded'));
        reset();
        router.refresh();
        return;
      }
      const field = res.fields?.includes('alt') ? 'alt' : 'file';
      const reason =
        res.reason ??
        (res.fields?.includes('alt') ? altMissing : res.code === 'forbidden' ? 'forbidden' : 'generic');
      fail(reason, field);
    };
    xhr.onerror = () => fail('network', null);
    xhr.send(body);
  }

  function onDrop(e: DragEvent<HTMLFieldSetElement>) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (!files.length || !fileRef.current) return;
    fileRef.current.files = files;
    setFileName(files[0]?.name ?? null);
    setError(null);
  }

  const fileError = error?.field === 'file' ? message(error) : undefined;
  const altError = error?.field === 'alt' ? message(error) : undefined;
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4" data-slot={slot}>
      <div className="flex flex-col gap-1">
        <Heading id={headingId} className="text-section">
          {title ?? t(`title.${key}`)}
        </Heading>
        <p className="text-body text-ink-2">{t(`hint.${key}`, { max: GALLERY_MAX })}</p>
        {multiple ? (
          <p className="text-caption text-ink-2">{t('count', { count: items.length, max: GALLERY_MAX })}</p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-body text-ink-2">
          {t(`empty.${key}`)}
        </p>
      ) : (
        <ul
          aria-label={t('listLabel')}
          className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((item) => (
            <MediaItemCard
              key={item.id}
              org={org}
              item={item}
              family={family}
              altError={altMissing}
              canWrite={ticket !== null}
              name={nameOf(item)}
              onReplace={() => {
                setReplaceId(item.id);
                setError(null);
                fileRef.current?.focus();
              }}
            />
          ))}
        </ul>
      )}

      {ticket === null ? (
        <p className="text-body text-ink-2">{t(family === 'logo' ? 'viewerNoticeLogo' : 'viewerNotice')}</p>
      ) : (
        <form
          noValidate
          onSubmit={onSubmit}
          aria-labelledby={`${id}-form-heading`}
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
        >
          <p id={`${id}-form-heading`} className="font-medium">
            {replacing
              ? t('replacingTitle', { name: nameOf(replacing) })
              : items.length > 0 && !multiple
                ? t('replaceSingleTitle')
                : t('addTitle')}
          </p>
          {full ? (
            <p className="text-body text-ink-2">{t('errors.slot_full', { max: GALLERY_MAX })}</p>
          ) : null}
          <fieldset
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'flex flex-col gap-2 rounded-card border border-dashed px-4 py-4',
              dragging ? 'border-ink bg-surface-2' : 'border-line-strong',
            )}
          >
            <label htmlFor={`${id}-file`} className="text-caption text-ink-2">
              {t('file')}
            </label>
            <input
              ref={fileRef}
              id={`${id}-file`}
              name="file"
              type="file"
              accept={UPLOAD_ACCEPT.join(',')}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${id}-file-error` : `${id}-file-hint`}
              onChange={(e) => {
                setFileName(e.currentTarget.files?.[0]?.name ?? null);
                setError(null);
              }}
              className="min-h-10 w-full min-w-0 text-body file:me-3 file:min-h-8 file:rounded-pill file:border file:border-line-strong file:bg-surface file:px-4 file:text-body"
            />
            <p id={`${id}-file-hint`} className="text-caption text-ink-2">
              {t('formats', { size })} {t('dropHint')}
            </p>
            {fileName ? <p className="text-caption text-ink-2">{t('chosen', { name: fileName })}</p> : null}
            {fileError ? (
              <p id={`${id}-file-error`} className="text-caption text-danger">
                {fileError}
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-alt`} className="text-caption text-ink-2">
              {t('alt')}
            </label>
            <input
              ref={altRef}
              id={`${id}-alt`}
              name="alt"
              value={alt}
              maxLength={300}
              disabled={decorative}
              onChange={(e) => {
                setAlt(e.currentTarget.value);
                if (error?.field === 'alt') setError(null);
              }}
              aria-invalid={altError ? true : undefined}
              aria-describedby={altError ? `${id}-alt-error` : `${id}-alt-hint`}
              className={cx('field w-full', altError ? 'border-danger' : 'border-line')}
            />
            {altError ? (
              <p id={`${id}-alt-error`} className="text-caption text-danger">
                {altError}
              </p>
            ) : (
              <p id={`${id}-alt-hint`} className="text-caption text-ink-2">
                {t('altHint')}
              </p>
            )}
          </div>
          {family !== 'content' ? null : (
            <label className="inline-flex min-h-6 items-center gap-2 text-body">
              <input
                type="checkbox"
                name="decorative"
                checked={decorative}
                onChange={(e) => {
                  setDecorative(e.currentTarget.checked);
                  if (error?.field === 'alt') setError(null);
                }}
                className="size-5"
              />
              {t('decorative')}
            </label>
          )}
          {error && error.field === null ? <Alert title={message(error)} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={progress !== null && progress < 100}
              aria-disabled={full || undefined}
            >
              {replacing || (items.length > 0 && !multiple) ? t('replaceSubmit') : t('upload')}
            </Button>
            {replacing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setReplaceId(null);
                  setError(null);
                }}
              >
                {t('cancelReplace')}
              </Button>
            ) : null}
          </div>
          {progress !== null && progress < 100 ? (
            <progress value={progress} max={100} aria-label={t('progress')} className="h-2 w-full" />
          ) : null}
          <p role="status" className="text-caption text-ink-2">
            {status}
          </p>
        </form>
      )}
    </section>
  );
}

function MediaItemCard({
  org,
  item,
  family,
  altError,
  canWrite,
  name,
  onReplace,
}: {
  org: string;
  item: MediaItem;
  family: Family;
  altError: string;
  canWrite: boolean;
  name: string;
  onReplace: () => void;
}) {
  const t = useTranslations('media');
  const te = useTranslations();
  const [removeState, removeAction, removing] = useActionState<FormState, FormData>(
    removeMediaAction.bind(null, org, item.id, family),
    INITIAL_FORM_STATE,
  );
  const [altState, altAction, saving] = useActionState<FormState, FormData>(
    updateMediaAltAction.bind(null, org, item.id, family),
    INITIAL_FORM_STATE,
  );
  const [decorative, setDecorative] = useState(item.decorative);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (altState.ok && detailsRef.current) detailsRef.current.open = false;
  }, [altState]);
  const altBad = !altState.ok && (altState.fields ?? []).includes('alt');
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
      <img
        src={item.preview}
        alt={item.decorative ? '' : (item.alt ?? '')}
        width={item.width}
        height={item.height}
        className="aspect-video w-full rounded-card bg-surface-2 object-contain"
      />
      <p className="text-caption text-ink-2">
        {item.decorative ? <span className="me-1 font-medium">{t('decorativeBadge')}</span> : null}
        {item.alt ?? ''}
      </p>
      {canWrite ? (
        <>
          <div className="flex flex-wrap gap-2">
            {family === 'content' ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onReplace}
                aria-label={`${t('replace')}: ${name}`}
              >
                {t('replace')}
              </Button>
            ) : null}
            <form action={removeAction}>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={removing}
                aria-label={`${t('remove')}: ${name}`}
              >
                {t('remove')}
              </Button>
            </form>
          </div>
          {removeState.code ? <Alert title={te(`errors.${removeState.code}`)} /> : null}
          <details ref={detailsRef} className="text-body">
            <summary className="inline-flex min-h-6 cursor-pointer items-center text-caption underline">
              {t('editAlt')}
              <span className="sr-only">: {name}</span>
            </summary>
            <form action={altAction} className="mt-2 flex flex-col gap-2">
              <Input
                id={`alt-${item.id}`}
                name="alt"
                label={t('alt')}
                defaultValue={item.alt ?? ''}
                maxLength={300}
                disabled={decorative}
                error={altBad ? t(`errors.${altError}`) : undefined}
              />
              {family === 'content' ? (
                <label className="inline-flex min-h-6 items-center gap-2">
                  <input
                    type="checkbox"
                    name="decorative"
                    value="1"
                    checked={decorative}
                    onChange={(e) => setDecorative(e.currentTarget.checked)}
                    className="size-5"
                  />
                  {t('decorative')}
                </label>
              ) : null}
              <Button type="submit" size="sm" disabled={saving} className="self-start">
                {t('save')}
              </Button>
            </form>
          </details>
          <p role="status" className="text-caption text-ink-2">
            {altState.ok ? t('altSaved') : ''}
          </p>
        </>
      ) : null}
    </li>
  );
}
