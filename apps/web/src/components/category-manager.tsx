'use client';

import { MAX_CATEGORY_NAME } from '@yayatoh/events/ui';
import { Alert, Button, Card, IconButton, Input, Select, StatusPill } from '@yayatoh/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** A message for a refused name: the specific reason when there is one. */
function useNameError(state: FormState) {
  const t = useTranslations('orgCategories');
  const te = useTranslations();
  if (!state.code) return undefined;
  if (
    state.reason &&
    ['name_required', 'name_too_long', 'name_taken', 'too_many', 'last_visible'].includes(state.reason)
  )
    return t(`errors.${state.reason}` as 'errors.name_taken', { max: MAX_CATEGORY_NAME });
  return te(errorMessageKey(state.code));
}

/** U8: add a category (its name and the marketplace category it maps to). */
export function AddCategoryForm({
  action,
  platformCategories,
}: {
  action: Action;
  platformCategories: readonly { key: string; label: string }[];
}) {
  const t = useTranslations('orgCategories');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const form = useRef<HTMLFormElement>(null);
  const error = useNameError(state);
  // A success clears the form for the next one.
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          name="name"
          label={t('name')}
          hint={t('nameHint', { max: MAX_CATEGORY_NAME })}
          maxLength={MAX_CATEGORY_NAME * 2}
          required
          error={error}
        />
        <Select
          name="platformKey"
          label={t('marketplace')}
          hint={t('marketplaceHint')}
          defaultValue="other"
          options={platformCategories.map((c) => ({ value: c.key, label: c.label, text: c.label }))}
        />
      </div>
      <div aria-live="polite">{state.ok && !pending ? <Alert tone="info" title={t('added')} /> : null}</div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('add')}
      </Button>
    </form>
  );
}

export interface CategoryRow {
  readonly ref: string;
  readonly label: string;
  readonly platformLabel: string;
  readonly renamed: boolean;
  readonly hidden: boolean;
  readonly eventCount: number;
}

/** U8: the ordered list; every row moves with buttons (the keyboard alternative to dragging). */
export function CategoryList({
  rows,
  action,
}: {
  rows: readonly CategoryRow[];
  action: (category: string, prev: FormState, form: FormData) => Promise<FormState>;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((r, i) => (
        <CategoryItem
          key={r.ref}
          row={r}
          first={i === 0}
          last={i === rows.length - 1}
          action={action.bind(null, r.ref)}
        />
      ))}
    </ol>
  );
}

function CategoryItem({
  row,
  first,
  last,
  action,
}: {
  row: CategoryRow;
  first: boolean;
  last: boolean;
  action: Action;
}) {
  const t = useTranslations('orgCategories');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [renaming, setRenaming] = useState(false);
  const error = useNameError(state);
  const renameButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.ok && state.reason === 'rename') setRenaming(false);
  }, [state]);
  const done = state.ok && !pending && state.reason ? t(`done.${state.reason}` as 'done.hide') : null;
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 grow flex-col gap-0.5">
            <h3 className="m-0 flex flex-wrap items-center gap-2 text-card break-words">
              {row.label}
              {row.hidden ? <StatusPill tone="neutral" label={t('hidden')} /> : null}
            </h3>
            <p className="m-0 text-caption text-ink-2">
              {row.renamed || row.platformLabel !== row.label
                ? `${t('mapsTo', { marketplace: row.platformLabel })} · ${t('events', { count: row.eventCount })}`
                : t('events', { count: row.eventCount })}
            </p>
          </div>
          <form
            action={formAction}
            onSubmit={keepValues(formAction)}
            className="flex flex-wrap items-center gap-2"
          >
            <IconButton
              type="submit"
              name="intent"
              value="up"
              size="sm"
              label={t('moveUp', { name: row.label })}
              icon={<ArrowUp aria-hidden="true" className="size-4" />}
              disabled={first || pending}
            />
            <IconButton
              type="submit"
              name="intent"
              value="down"
              size="sm"
              label={t('moveDown', { name: row.label })}
              icon={<ArrowDown aria-hidden="true" className="size-4" />}
              disabled={last || pending}
            />
            <Button
              ref={renameButton}
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={renaming}
              aria-label={t('renameLabel', { name: row.label })}
              onClick={() => setRenaming((v) => !v)}
            >
              {t('rename')}
            </Button>
            <Button
              type="submit"
              name="intent"
              value={row.hidden ? 'show' : 'hide'}
              variant="secondary"
              size="sm"
              disabled={pending}
              aria-label={t(row.hidden ? 'showLabel' : 'hideLabel', { name: row.label })}
            >
              {t(row.hidden ? 'show' : 'hide')}
            </Button>
          </form>
        </div>
        {renaming ? (
          <form
            action={formAction}
            onSubmit={keepValues(formAction)}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="intent" value="rename" />
            <div className="min-w-0 grow sm:max-w-96">
              <Input
                name="name"
                label={t('newName', { name: row.label })}
                defaultValue={row.label}
                maxLength={MAX_CATEGORY_NAME * 2}
                required
                autoFocus
                error={state.reason !== 'last_visible' ? error : undefined}
              />
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {t('saveName')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRenaming(false);
                renameButton.current?.focus();
              }}
            >
              {t('cancel')}
            </Button>
          </form>
        ) : null}
        <div aria-live="polite">
          {done ? <p className="m-0 text-caption text-success">{done}</p> : null}
          {error && (!renaming || state.reason === 'last_visible') ? <Alert title={error} /> : null}
        </div>
      </Card>
    </li>
  );
}
