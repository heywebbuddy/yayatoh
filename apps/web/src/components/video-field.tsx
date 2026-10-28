'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

export interface VideoFieldValue {
  /** A https YouTube/Vimeo link, or the storage path of an uploaded video. */
  readonly url: string | null;
  /** The storage path of the uploaded video's poster (null for a link). */
  readonly poster: string | null;
}

const isUploaded = (u: string | null) => !!u && u.startsWith('/video/');

/**
 * Upload a video to our own storage OR paste a YouTube/Vimeo link. Reusable in any form: it
 * renders two hidden inputs, `{name}` (the link or the uploaded video's path) and `{name}Poster`
 * (the poster's path, empty for a link), which the server action reads. `org` is the organization's
 * slug (the upload is checked against the signed-in member's role). Nothing here sets inline
 * styles: the progress bar is the native `<progress>` element.
 */
export function VideoField({
  name,
  org,
  initial,
  maxBytes,
  label,
  hint,
  linkPlaceholder,
  onChange,
}: {
  name: string;
  org: string;
  initial: VideoFieldValue;
  /** The server's upload limit (`videoMaxBytes()`), so the browser can refuse early. */
  maxBytes: number;
  label: string;
  hint?: string;
  linkPlaceholder?: string;
  /** Called with the current value whenever it changes (for forms that keep their own state). */
  onChange?: (value: VideoFieldValue) => void;
}) {
  const t = useTranslations('videoField');
  const id = useId();
  const [mode, setMode] = useState<'link' | 'upload'>(isUploaded(initial.url) ? 'upload' : 'link');
  const [value, setValue] = useState<VideoFieldValue>(initial);
  const [link, setLink] = useState(isUploaded(initial.url) ? '' : (initial.url ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);

  const upload = () => {
    const video = fileRef.current?.files?.[0];
    const poster = posterRef.current?.files?.[0];
    if (!video) return setError(t('chooseFile'));
    if (!/^video\/(mp4|webm)$/.test(video.type) && !/\.(mp4|webm)$/i.test(video.name))
      return setError(t('error.unsupported'));
    if (video.size > maxBytes) return setError(t('error.too_large', { mb: Math.round(maxBytes / 1048576) }));
    const body = new FormData();
    body.set('org', org);
    body.set('video', video);
    if (poster) body.set('poster', poster);
    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      setProgress(null);
      setError(t('error.failed'));
    };
    xhr.onload = () => {
      setProgress(null);
      let res: { ok?: boolean; url?: string; poster?: string; code?: string } = {};
      try {
        res = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON (a proxy error page): the generic message below.
      }
      if (res.ok && res.url && res.poster) {
        setValue({ url: res.url, poster: res.poster });
      } else {
        const code = res.code ?? 'failed';
        setError(
          code === 'too_large'
            ? t('error.too_large', { mb: Math.round(maxBytes / 1048576) })
            : t.has(`error.${code}`)
              ? t(`error.${code}`)
              : t('error.failed'),
        );
      }
    };
    xhr.send(body);
  };

  const submitted: VideoFieldValue =
    mode === 'link' ? { url: link.trim() || null, poster: null } : { url: value.url, poster: value.poster };
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the value itself changes
  useEffect(() => {
    onChange?.(submitted);
  }, [submitted.url, submitted.poster]);
  const tab = (m: 'link' | 'upload') =>
    `inline-flex min-h-10 items-center rounded-pill border px-4 text-body font-bold ${
      mode === m ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface text-ink-2'
    }`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-body font-extrabold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={mode === 'link'}
          className={tab('link')}
          onClick={() => setMode('link')}
        >
          {t('modeLink')}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'upload'}
          className={tab('upload')}
          onClick={() => setMode('upload')}
        >
          {t('modeUpload')}
        </button>
      </div>
      {mode === 'link' ? (
        <input
          type="url"
          inputMode="url"
          maxLength={300}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={linkPlaceholder}
          aria-label={t('modeLink')}
          className="field w-full"
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-tile border border-line bg-surface p-3.5">
          <label htmlFor={`${id}-file`} className="text-[13px] font-bold text-ink">
            {t('file')}
          </label>
          <input
            id={`${id}-file`}
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm"
            className="field w-full"
          />
          <label htmlFor={`${id}-poster`} className="text-[13px] font-bold text-ink">
            {t('poster')}
          </label>
          <input
            id={`${id}-poster`}
            ref={posterRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="field w-full"
          />
          <p className="m-0 text-caption text-ink-2">{t('limits', { mb: Math.round(maxBytes / 1048576) })}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={upload} disabled={progress !== null}>
              {t('upload')}
            </Button>
            {progress !== null ? (
              <progress value={progress} max={100} aria-label={t('uploading')} className="h-2 w-40" />
            ) : null}
            {value.url && isUploaded(value.url) ? (
              <>
                <span role="status" className="text-caption font-bold text-success">
                  {t('uploaded')}
                </span>
                <Button type="button" variant="ghost" onClick={() => setValue({ url: null, poster: null })}>
                  {t('remove')}
                </Button>
              </>
            ) : null}
          </div>
          {value.url && isUploaded(value.url) && value.poster ? (
            // biome-ignore lint/performance/noImgElement: a same-origin preview of the stored poster
            <img
              src={value.poster}
              alt=""
              className="h-24 w-auto self-start rounded-tile border border-line"
            />
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 text-caption font-bold text-danger">
          {error}
        </p>
      ) : null}
      {hint ? <p className="m-0 text-caption text-ink-2">{hint}</p> : null}
      <input type="hidden" name={name} value={submitted.url ?? ''} />
      <input type="hidden" name={`${name}Poster`} value={submitted.poster ?? ''} />
    </fieldset>
  );
}
