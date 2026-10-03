'use client';

import { Alert, Button, StatusPill } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { deleteLibraryImageAction } from '@/app/[locale]/o/[org]/media-actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { formatBytes } from '@/lib/bytes.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import type { LibraryEntry } from '@/server/media.ts';

/**
 * U10: the media library's images. Each card: the image, its alt text, size and dimensions, and
 * "Used in" (links to each place). Only an image used nowhere can be deleted, after a confirm
 * step; images in use say where to remove them first.
 */
export function LibraryGrid({
  org,
  items,
  canDelete,
}: {
  org: string;
  items: readonly LibraryEntry[];
  canDelete: boolean;
}) {
  const t = useTranslations('mediaLibrary');
  return (
    <ul
      aria-label={t('listLabel')}
      className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
    >
      {items.map((item) => (
        <LibraryCard key={item.id} org={org} item={item} canDelete={canDelete} />
      ))}
    </ul>
  );
}

function LibraryCard({ org, item, canDelete }: { org: string; item: LibraryEntry; canDelete: boolean }) {
  const t = useTranslations('mediaLibrary');
  const te = useTranslations();
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteLibraryImageAction.bind(null, org, item.id),
    INITIAL_FORM_STATE,
  );
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const name = item.alt ?? t('decorativeName');
  const unused = item.usedIn.length === 0;
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
      <img
        src={item.preview}
        srcSet={item.srcSet || undefined}
        sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
        alt={item.decorative ? '' : (item.alt ?? '')}
        width={item.width}
        height={item.height}
        loading="lazy"
        className="aspect-video w-full rounded-card bg-surface-2 object-contain"
      />
      <p className="break-words text-body font-semibold">{item.alt ?? t('decorativeName')}</p>
      <p className="text-caption text-ink-2">
        {t('meta', {
          size: formatBytes(item.bytes, locale),
          width: item.width,
          height: item.height,
          type: item.sourceType.toUpperCase(),
        })}
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-caption font-bold text-ink-2">{t('usedIn')}</p>
        {unused ? (
          <StatusPill tone="neutral" label={t('unused')} />
        ) : (
          <ul
            aria-label={t('usedInFor', { name })}
            className="flex list-none flex-col gap-0.5 p-0 text-caption"
          >
            {item.usedIn.map((p) => (
              <li key={p.assetId}>
                {p.href ? (
                  <Link href={p.href} className="inline-flex min-h-6 items-center underline">
                    {t(`places.${p.ownerType}`, { name: p.label })}
                  </Link>
                ) : (
                  t(`places.${p.ownerType}`, { name: p.label })
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canDelete && unused ? (
        confirming ? (
          <form
            action={action}
            className="flex flex-col gap-2 rounded-card border border-danger/30 bg-danger-soft p-2"
          >
            <p className="text-caption">{t('confirmDelete')}</p>
            <div className="flex flex-wrap gap-2">
              <Button ref={confirmRef} type="submit" variant="danger" size="sm" disabled={pending}>
                {t('deleteForGood')}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setConfirming(true)}
            aria-label={t('deleteFor', { name })}
          >
            {t('delete')}
          </Button>
        )
      ) : canDelete ? (
        <p className="text-caption text-ink-2">{t('inUseNote')}</p>
      ) : null}
      {state.code ? (
        <Alert title={state.reason === 'in_use' ? t('inUseNote') : te(`errors.${state.code}`)} />
      ) : null}
    </li>
  );
}
