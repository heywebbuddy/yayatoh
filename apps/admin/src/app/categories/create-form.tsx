'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { createPlatformCategoryAction } from './actions.ts';

export function CreateCategoryForm() {
  const t = useTranslations('platformCategories');
  const [error, action, pending] = useActionState(createPlatformCategoryAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {error ? <Alert title={t(`error.${error}` as 'error.invalid')} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-2 text-body font-semibold">
          {t('name')}
          <input name="label" required maxLength={60} className="field w-full" />
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-body font-semibold">
          {t('key')}
          <input name="key" required maxLength={60} pattern="[a-z][a-z0-9_]{0,59}" className="field w-full" />
          <span className="text-caption font-normal text-ink-2">{t('keyHint')}</span>
        </label>
      </div>
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" name="include" defaultChecked className="size-5 accent-primary" />
        {t('include')}
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {t(pending ? 'creating' : 'create')}
      </Button>
    </form>
  );
}
