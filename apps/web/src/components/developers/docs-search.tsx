'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { type DocsEntry, matchDocs } from '@/lib/docs-search.ts';

/**
 * Search the developer docs (M6.3b): results appear as you type (links, reachable with Tab), and
 * Enter submits to `/developers?q=…`, which the server answers the same way without JavaScript.
 */
export function DocsSearch({
  index,
  action,
  initial = '',
}: {
  index: readonly DocsEntry[];
  action: string;
  initial?: string;
}) {
  const t = useTranslations('developers.search');
  const [q, setQ] = useState(initial);
  const id = useId();
  const results = useMemo(() => matchDocs(index, q, 8), [index, q]);
  const active = q.trim().length >= 2;
  return (
    <search className="relative flex flex-col gap-2">
      <form action={action} method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-q`} className="text-caption text-ink-2">
            {t('label')}
          </label>
          <input
            id={`${id}-q`}
            name="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('');
            }}
            autoComplete="off"
            placeholder={t('placeholder')}
            aria-describedby={`${id}-status`}
            className="min-h-10 w-full rounded-pill border border-line bg-surface-solid px-4 text-body"
          />
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-pill border border-line bg-surface-solid px-4 text-body font-medium hover:bg-surface-2"
        >
          {t('submit')}
        </button>
      </form>
      <p id={`${id}-status`} aria-live="polite" className="sr-only">
        {active ? t('results', { count: results.length }) : ''}
      </p>
      {active ? (
        results.length === 0 ? (
          <p className="text-body text-ink-2">{t('none')}</p>
        ) : (
          <ul
            aria-label={t('resultsLabel')}
            className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface-solid"
          >
            {results.map((r) => (
              <li key={`${r.kind}:${r.href}`}>
                <Link href={r.href} className="flex min-h-11 flex-col gap-0.5 px-4 py-2 hover:bg-surface-2">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-caption text-ink-2">{t(`kinds.${r.kind}`)}</span>
                    <span dir="ltr" lang="en" className="font-mono text-caption text-ink">
                      {r.title}
                    </span>
                  </span>
                  <span lang="en" className="text-caption text-ink-2">
                    {r.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </search>
  );
}
