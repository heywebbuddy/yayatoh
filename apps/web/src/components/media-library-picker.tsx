'use client';

import { Alert, Button, Checkbox, cx, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import { pickerLibraryAction, reuseFromLibraryAction } from '@/app/[locale]/o/[org]/media-actions.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type PickerItem = Awaited<ReturnType<typeof pickerLibraryAction>>['items'][number];

/**
 * U10: "Choose from the media library" inside an uploader. A real radio group of thumbnails
 * (arrow keys move, Space picks; each radio is named by the image's alt text), the alt text for
 * this place (prefilled with the library's, required unless decorative) and one button. The
 * image is placed without uploading again: nothing new is stored.
 *
 * With `multiple` (galleries and venue photos) the thumbnails are checkboxes: pick one or more
 * (up to `room`), each with its own alt text, and place them all with one button.
 */
export function LibraryPicker({
  org,
  ticket,
  allowDecorative,
  defaultAlt = '',
  replaceAssetId = null,
  multiple = false,
  room = 1,
}: {
  org: string;
  ticket: string;
  allowDecorative: boolean;
  defaultAlt?: string;
  replaceAssetId?: string | null;
  multiple?: boolean;
  /** How many more images fit here (multiple only). */
  room?: number;
}) {
  const t = useTranslations('mediaLibrary.picker');
  const te = useTranslations();
  const router = useRouter();
  const id = useId();
  const [items, setItems] = useState<PickerItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [alt, setAlt] = useState(defaultAlt);
  /** Multiple: the picked images in order, and each one's alt text. */
  const [picked, setPicked] = useState<string[]>([]);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [decorative, setDecorative] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    reuseFromLibraryAction.bind(null, org, ticket),
    INITIAL_FORM_STATE,
  );
  useEffect(() => {
    if (state.ok) {
      setChosen(null);
      setAlt(defaultAlt);
      setPicked([]);
      setAlts({});
      router.refresh();
    } else {
      const first = (state.fields ?? []).find((f) => f === 'alt' || f.startsWith('alt:'));
      if (first)
        document.getElementById(first === 'alt' ? `${id}-alt` : `${id}-alt-${first.slice(4)}`)?.focus();
    }
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
  const anyAltError = altError ?? ([...bad].some((f) => f.startsWith('alt:')) ? t('altRequired') : undefined);
  const many = multiple && !replaceAssetId;
  const full = many && picked.length >= room;
  function toggle(i: PickerItem, on: boolean) {
    setPicked((p) => (on ? [...p, i.id] : p.filter((x) => x !== i.id)));
    if (on) setAlts((a) => ({ ...a, [i.id]: a[i.id] ?? i.alt ?? '' }));
  }
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
          <form action={action} onSubmit={keepValues(action)} noValidate className="flex flex-col gap-3">
            {replaceAssetId ? <input type="hidden" name="replaceAssetId" value={replaceAssetId} /> : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-bold text-ink">
                {many ? t('chooseMany', { max: room }) : t('choose')}
              </legend>
              <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((i) => {
                  const on = many ? picked.includes(i.id) : chosen === i.id;
                  return (
                    <label
                      key={i.id}
                      className={cx(
                        'relative flex cursor-pointer flex-col gap-1 rounded-card border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                        on ? 'border-ink bg-surface-2' : 'border-line',
                        full && !on ? 'cursor-not-allowed opacity-60' : '',
                      )}
                    >
                      <input
                        type={many ? 'checkbox' : 'radio'}
                        name="sourceAssetId"
                        value={i.id}
                        checked={on}
                        disabled={many && full && !on}
                        onChange={(e) => {
                          if (many) return toggle(i, e.currentTarget.checked);
                          setChosen(i.id);
                          setAlt(i.alt ?? '');
                          setDecorative(false);
                        }}
                        className="sr-only"
                        aria-label={i.alt ?? t('noAlt')}
                      />
                      {many && on ? (
                        <span
                          aria-hidden="true"
                          className="absolute end-3 top-3 grid size-6 place-items-center rounded-pill bg-ink text-caption font-bold text-canvas"
                        >
                          {picked.indexOf(i.id) + 1}
                        </span>
                      ) : null}
                      <img
                        src={i.preview}
                        alt=""
                        width={i.width}
                        height={i.height}
                        className="aspect-video w-full rounded-card bg-surface-2 object-contain"
                      />
                      <span className="line-clamp-2 text-caption text-ink-2">{i.alt ?? t('noAlt')}</span>
                    </label>
                  );
                })}
              </div>
              {many ? (
                <p role="status" className="text-caption text-ink-2">
                  {t('chosenCount', { count: picked.length })}
                  {full ? ` ${t('roomFull', { max: room })}` : ''}
                </p>
              ) : null}
            </fieldset>
            {many ? (
              picked.length ? (
                <fieldset disabled={decorative} className="flex flex-col gap-3">
                  <legend className="mb-1 text-[13px] font-bold text-ink">{t('altMany')}</legend>
                  {picked.map((pid, n) => {
                    const item = items.find((x) => x.id === pid);
                    return (
                      <div key={pid} className="flex items-start gap-3">
                        {item ? (
                          <img
                            src={item.preview}
                            alt=""
                            width={item.width}
                            height={item.height}
                            className="mt-6 aspect-video w-20 shrink-0 rounded-card bg-surface-2 object-cover"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <Input
                            id={`${id}-alt-${pid}`}
                            name={`alt:${pid}`}
                            value={alts[pid] ?? ''}
                            maxLength={300}
                            onChange={(e) => {
                              const v = e.currentTarget.value;
                              setAlts((a) => ({ ...a, [pid]: v }));
                            }}
                            label={t('altForImage', { n: n + 1 })}
                            error={bad.has(`alt:${pid}`) ? t('altRequired') : undefined}
                          />
                        </div>
                      </div>
                    );
                  })}
                </fieldset>
              ) : null
            ) : (
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
            )}
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
                  {state.reason === 'partly_here'
                    ? t('partlyHere')
                    : state.reason === 'placed_many'
                      ? t('placedMany')
                      : t('placed')}
                </p>
              ) : state.reason === 'already_here' ? (
                <Alert title={t('alreadyHere')} />
              ) : state.reason === 'no_choice' ? (
                <Alert title={t('noChoice')} />
              ) : state.code && !anyAltError ? (
                <Alert title={te(`errors.${state.code}`)} />
              ) : null}
            </div>
            <Button type="submit" variant="secondary" disabled={pending} className="self-start">
              {many ? t('useMany', { count: picked.length }) : t('use')}
            </Button>
          </form>
        )}
      </div>
    </details>
  );
}
