'use client';

import { Alert, Button, Checkbox, cx, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import { pickerLibraryAction, reuseFromLibraryAction } from '@/app/[locale]/o/[org]/media-actions.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type PickerItem = Awaited<ReturnType<typeof pickerLibraryAction>>['items'][number];

/**
 * U10: "Choose from the media library" inside an uploader. A real radio group of thumbnails
 * (arrow keys move, Space picks; each radio is named by the image's alt text), the alt text for
 * this place (prefilled with the library's, required unless decorative) and one button. The
 * image is placed without uploading again: nothing new is stored.
 */
export function LibraryPicker({
  org,
  ticket,
  allowDecorative,
  defaultAlt = '',
  replaceAssetId = null,
}: {
  org: string;
  ticket: string;
  allowDecorative: boolean;
  defaultAlt?: string;
  replaceAssetId?: string | null;
}) {
  const t = useTranslations('mediaLibrary.picker');
  const te = useTranslations();
  const router = useRouter();
  const id = useId();
  const [items, setItems] = useState<PickerItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [alt, setAlt] = useState(defaultAlt);
  const [decorative, setDecorative] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    reuseFromLibraryAction.bind(null, org, ticket),
    INITIAL_FORM_STATE,
  );
  useEffect(() => {
    if (state.ok) {
      setChosen(null);
      setAlt(defaultAlt);
      router.refresh();
    } else if ((state.fields ?? []).includes('alt')) document.getElementById(`${id}-alt`)?.focus();
  }, [state, router, defaultAlt, id]);

  async function load() {
    if (items !== null || loading) return;
    setLoading(true);
    try {
      setItems((await pickerLibraryAction(org)).items);
    } finally {
      setLoading(false);
    }
  }

  const bad = new Set(state.fields ?? []);
  const altError = bad.has('alt') ? t('altRequired') : undefined;
  return (
    <details
      className="rounded-card border border-line bg-surface p-4"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary className="inline-flex min-h-6 cursor-pointer items-center font-medium">{t('open')}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-caption text-ink-2">{t('hint')}</p>
        {loading || items === null ? (
          <p role="status" className="text-body text-ink-2">
            {t('loading')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-body text-ink-2">
            {t('empty')}{' '}
            <a href={`/o/${org}/media`} className="underline">
              {t('openLibrary')}
            </a>
          </p>
        ) : (
          <form action={action} noValidate className="flex flex-col gap-3">
            {replaceAssetId ? <input type="hidden" name="replaceAssetId" value={replaceAssetId} /> : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-bold text-ink">{t('choose')}</legend>
              <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((i) => (
                  <label
                    key={i.id}
                    className={cx(
                      'flex cursor-pointer flex-col gap-1 rounded-card border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                      chosen === i.id ? 'border-ink bg-surface-2' : 'border-line',
                    )}
                  >
                    <input
                      type="radio"
                      name="sourceAssetId"
                      value={i.id}
                      checked={chosen === i.id}
                      onChange={() => {
                        setChosen(i.id);
                        setAlt(i.alt ?? '');
                        setDecorative(false);
                      }}
                      className="sr-only"
                      aria-label={i.alt ?? t('noAlt')}
                    />
                    <img
                      src={i.preview}
                      alt=""
                      width={i.width}
                      height={i.height}
                      className="aspect-video w-full rounded-card bg-surface-2 object-contain"
                    />
                    <span className="line-clamp-2 text-caption text-ink-2">{i.alt ?? t('noAlt')}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Input
              id={`${id}-alt`}
              name="alt"
              value={alt}
              maxLength={300}
              disabled={decorative}
              onChange={(e) => setAlt(e.currentTarget.value)}
              label={t('alt')}
              hint={t('altHint')}
              error={altError}
            />
            {allowDecorative ? (
              <Checkbox
                id={`${id}-decorative`}
                name="decorative"
                value="1"
                checked={decorative}
                onChange={(e) => setDecorative(e.currentTarget.checked)}
                label={t('decorative')}
              />
            ) : null}
            <div aria-live="polite">
              {state.ok ? (
                <p role="status" className="text-caption text-success">
                  {t('placed')}
                </p>
              ) : state.reason === 'already_here' ? (
                <Alert title={t('alreadyHere')} />
              ) : state.reason === 'no_choice' ? (
                <Alert title={t('noChoice')} />
              ) : state.code && !altError ? (
                <Alert title={te(`errors.${state.code}`)} />
              ) : null}
            </div>
            <Button type="submit" variant="secondary" disabled={pending} className="self-start">
              {t('use')}
            </Button>
          </form>
        )}
      </div>
    </details>
  );
}
