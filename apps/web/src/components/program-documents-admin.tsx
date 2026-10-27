'use client';

import type { ProgramDocumentDto } from '@yayatoh/media';
import { Alert, Button, Input } from '@yayatoh/ui';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

const REASONS = new Set(['no_file', 'too_large', 'unsupported_type', 'too_many']);

/**
 * PDF brochures of a sponsor or an exhibitor: the list with remove buttons, and an upload form
 * (title + PDF). Uploads go to `/api/program-docs/upload` (multipart, size-capped before reading).
 */
export function ProgramDocumentsAdmin({
  orgId,
  ownerType,
  ownerId,
  docs,
  canWrite,
  remove,
  idPrefix,
}: {
  orgId: string;
  ownerType: 'sponsor' | 'exhibitor';
  ownerId: string;
  docs: readonly ProgramDocumentDto[];
  canWrite: boolean;
  remove: (documentId: string) => Promise<void>;
  idPrefix: string;
}) {
  const t = useTranslations('programDocs');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set('orgId', orgId);
    data.set('ownerType', ownerType);
    data.set('ownerId', ownerId);
    data.set('locale', locale);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch('/api/program-docs/upload', { method: 'POST', body: data });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (!res.ok || !body.ok) {
        setError(body.reason && REASONS.has(body.reason) ? body.reason : 'generic');
      } else {
        form.reset();
        setDone(true);
        router.refresh();
      }
    } catch {
      setError('generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="flex flex-col gap-3">
      <h4 id={`${idPrefix}-heading`} className="m-0 text-body font-bold">
        {t('title')}
      </h4>
      {docs.length === 0 ? (
        <p className="m-0 text-caption text-ink-2">{t('none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <FileText aria-hidden="true" className="size-4 text-primary-ink" />
              <a href={d.href} className="text-body underline underline-offset-2">
                {d.title}
              </a>
              {canWrite ? (
                <form action={remove.bind(null, d.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    {t('remove', { name: d.title })}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Input id={`${idPrefix}-title`} name="title" label={t('titleLabel')} maxLength={120} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-file`} className="text-[13px] font-bold text-ink">
              {t('file')}
            </label>
            <input
              id={`${idPrefix}-file`}
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
              className="text-body"
            />
            <p className="m-0 text-caption text-ink-2">{t('fileHint')}</p>
          </div>
          <div aria-live="polite">
            {error ? <Alert title={t(`errors.${error}` as 'errors.generic')} /> : null}
            {done ? <Alert tone="info" title={t('uploaded')} /> : null}
          </div>
          <Button type="submit" disabled={busy} className="self-start">
            {busy ? t('uploading') : t('upload')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
