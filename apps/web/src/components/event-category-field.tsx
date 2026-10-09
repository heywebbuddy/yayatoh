'use client';

import { Button, Select } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Link } from '@/i18n/navigation.ts';

export interface EventCategoryChoice {
  ref: string;
  label: string;
}

export function EventCategoryField({
  id,
  categories,
  value,
  onValueChange,
  manageHref,
  error,
}: {
  id: string;
  categories: readonly EventCategoryChoice[];
  value: string;
  onValueChange: (value: string) => void;
  manageHref?: string;
  error?: string;
}) {
  const t = useTranslations('newEvent');
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {t('category')}
      </label>
      <Select
        id={id}
        name="orgCategory"
        value={value}
        onValueChange={onValueChange}
        className="field w-full"
        aria-describedby={`${id}-hint`}
        error={error}
      >
        <option value="">{t('categoryNone')}</option>
        {categories.map((c) => (
          <option key={c.ref} value={c.ref}>
            {c.label}
          </option>
        ))}
      </Select>
      <p id={`${id}-hint`} className="m-0 text-caption text-ink-2">
        {t('categoryHint')}{' '}
        {manageHref ? (
          <Link
            href={manageHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {t('manageCategories')}
          </Link>
        ) : null}
      </p>
      {manageHref ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={refreshing}
          onClick={() => refresh(() => router.refresh())}
        >
          {t(refreshing ? 'refreshingCategories' : 'refreshCategories')}
        </Button>
      ) : null}
    </div>
  );
}
