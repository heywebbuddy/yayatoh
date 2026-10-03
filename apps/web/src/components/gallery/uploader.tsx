'use client';

import { GALLERY_ACCEPT, NAME_MAX } from '@yayatoh/gallery/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { type DoneResult, type SlotResult, UPLOAD_REASONS } from './types.ts';

type Row = {
  readonly key: string;
  readonly name: string;
  readonly state: 'waiting' | 'uploading' | 'published' | 'pending' | 'failed';
  readonly error?: string;
};

/**
 * The gallery uploader (M4.5b), for the host console and the guest page. Each chosen photo gets
 * a signed slot from the server, goes straight to storage with one PUT (the slot's URL, never
 * through a form post), then is completed: sniffed, re-encoded and published or held for the
 * hosts. A native file input (keyboard and screen readers), a visible label, a 44 px button, and
 * a polite live list of what happened to each file. HEIC from phones is accepted.
 */
export function GalleryUploader({
  request,
  complete,
  maxBytes,
  askName,
  defaultName,
  idPrefix,
  notice,
}: {
  request: (meta: { bytes: number; caption: string | null; name: string | null }) => Promise<SlotResult>;
  complete: (itemId: string) => Promise<DoneResult>;
  maxBytes: number;
  /** Guests type a name with their first upload. */
  askName: boolean;
  defaultName?: string | null;
  idPrefix: string;
  /**
   * Shown instead of the fields when nothing more can be shared (the gallery is full, the guest's
   * quota is used). The uploader stays mounted, so what happened to each file stays on screen.
   */
  notice?: ReactNode;
}) {
  const t = useTranslations('gallery.uploader');
  const te = useTranslations('errors');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const uid = useId();
  const id = (n: string) => `${idPrefix}-${n}`;

  const message = (code: string, reason?: string | null) =>
    reason && (UPLOAD_REASONS as readonly string[]).includes(reason)
      ? t(`errors.${reason}`, { mb: Math.round(maxBytes / 1024 / 1024) })
      : te.has(code)
        ? te(code)
        : te('internal');

  async function upload(
    file: File,
    caption: string | null,
    name: string | null,
  ): Promise<Omit<Row, 'key' | 'name'>> {
    if (file.size > maxBytes) return { state: 'failed', error: message('validation_failed', 'too_large') };
    if (file.size === 0) return { state: 'failed', error: message('validation_failed', 'unsupported_type') };
    const slot = await request({ bytes: file.size, caption, name });
    if (!slot.ok) {
      if (slot.reason === 'required') setNameError(t('nameRequired'));
      return {
        state: 'failed',
        error: slot.reason === 'required' ? t('nameRequired') : message(slot.code, slot.reason),
      };
    }
    try {
      const put = await fetch(slot.url, { method: 'PUT', body: file, headers: slot.headers });
      if (!put.ok)
        return {
          state: 'failed',
          error: message('internal', put.status === 400 ? 'size_mismatch' : 'network'),
        };
    } catch {
      return { state: 'failed', error: message('internal', 'network') };
    }
    const done = await complete(slot.itemId);
    if (!done.ok) return { state: 'failed', error: message(done.code, done.reason) };
    if (done.status === 'refused')
      return { state: 'failed', error: message('validation_failed', done.reason) };
    return { state: done.status };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = askName ? String(data.get('name') ?? '').trim() : '';
    const caption = String(data.get('caption') ?? '').trim() || null;
    const files = (data.getAll('photos') as File[]).filter((f) => f instanceof File && f.name);
    setNameError(null);
    setFileError(null);
    if (askName && !name) {
      setNameError(t('nameRequired'));
      form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
      return;
    }
    if (files.length === 0) {
      setFileError(t('chooseFirst'));
      form.querySelector<HTMLInputElement>('[name="photos"]')?.focus();
      return;
    }
    setBusy(true);
    const keyed: Row[] = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, state: 'waiting' }));
    setRows(keyed);
    let current = keyed;
    for (const [i, file] of files.entries()) {
      current = current.map((r, j) => (j === i ? { ...r, state: 'uploading' } : r));
      setRows(current);
      const result = await upload(file, caption, askName ? name : null);
      current = current.map((r, j) => (j === i ? { ...r, ...result } : r));
      setRows(current);
    }
    setBusy(false);
    const fileInput = form.querySelector<HTMLInputElement>('[name="photos"]');
    if (fileInput) fileInput.value = '';
    statusRef.current?.focus();
    router.refresh();
  }

  const done = rows.filter((r) => r.state === 'published' || r.state === 'pending').length;
  const failed = rows.filter((r) => r.state === 'failed').length;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {notice && !busy ? notice : null}
      {notice && !busy ? null : askName ? (
        <Input
          id={id('name')}
          name="name"
          label={t('name')}
          hint={t('nameHint')}
          defaultValue={defaultName ?? ''}
          maxLength={NAME_MAX}
          autoComplete="name"
          required
          error={nameError ?? undefined}
        />
      ) : null}
      {notice && !busy ? null : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={id('photos')} className="text-[13px] font-bold text-ink">
              {t('photos')}
            </label>
            <input
              id={id('photos')}
              name="photos"
              type="file"
              multiple
              accept={GALLERY_ACCEPT.join(',')}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${uid}-file-error` : `${uid}-file-hint`}
              className="field min-h-11 py-2"
            />
            {fileError ? (
              <p id={`${uid}-file-error`} className="text-caption text-danger">
                {fileError}
              </p>
            ) : (
              <p id={`${uid}-file-hint`} className="text-caption text-ink-2">
                {t('photosHint', { mb: Math.round(maxBytes / 1024 / 1024) })}
              </p>
            )}
          </div>
          <Input
            id={id('caption')}
            name="caption"
            label={t('caption')}
            hint={t('captionHint')}
            maxLength={280}
          />
          <div>
            <Button type="submit" loading={busy}>
              {busy ? t('uploading') : t('submit')}
            </Button>
          </div>
        </>
      )}
      <section aria-labelledby={`${uid}-status`} className={rows.length ? 'flex flex-col gap-2' : 'sr-only'}>
        <h3 id={`${uid}-status`} ref={statusRef} tabIndex={-1} className="m-0 text-body font-bold text-ink">
          {rows.length === 0
            ? t('statusTitle')
            : busy
              ? t('statusBusy', {
                  done: rows.filter((r) => r.state !== 'waiting' && r.state !== 'uploading').length,
                  total: rows.length,
                })
              : t('statusDone', { done, failed })}
        </h3>
        <ul aria-live="polite" className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((r) => (
            <li key={r.key} className="text-caption text-ink-2" data-upload-state={r.state}>
              <span className="font-bold text-ink">{r.name}</span>
              {': '}
              {r.state === 'failed' ? <span className="text-danger">{r.error}</span> : t(`state.${r.state}`)}
            </li>
          ))}
        </ul>
        {!busy && done > 0 && rows.some((r) => r.state === 'pending') ? (
          <Alert tone="info" title={t('heldNotice')} />
        ) : null}
      </section>
    </form>
  );
}
