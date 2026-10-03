'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FavoriteActionState } from './types.ts';

type Action = (prev: FavoriteActionState, form: FormData) => Promise<FavoriteActionState>;
const INITIAL: FavoriteActionState = { ok: false, code: null };

/**
 * A session's star in the conference hub (M5.10a): a toggle button (`aria-pressed`). Starring a
 * session that overlaps the personal schedule asks first: the sessions in the way are named, with
 * "Keep both", "Replace" (only favorites in the way) and "Cancel". Feedback is announced politely.
 * 44 px targets (phone-first).
 */
export function FavoriteToggle({
  action,
  title,
  favorite,
}: {
  action: Action;
  title: string;
  favorite: boolean;
}) {
  const t = useTranslations('conferenceHub');
  const te = useTranslations();
  const [result, formAction, pending] = useActionState(action, INITIAL);
  const [dismissed, setDismissed] = useState<number | undefined>(undefined);
  const promptRef = useRef<HTMLDivElement>(null);
  const conflict = !result.ok && result.reason === 'overlap' && dismissed !== result.stamp;
  useEffect(() => {
    if (conflict) promptRef.current?.focus();
  }, [conflict]);
  const done = result.ok
    ? result.favorite
      ? result.removed
        ? t('favorite.replaced', { count: result.removed })
        : t('favorite.added', { title })
      : t('favorite.removed', { title })
    : null;
  const refusal =
    !result.ok && result.code && !conflict && dismissed !== result.stamp
      ? result.reason === 'too_many'
        ? t('favorite.tooMany')
        : te(errorMessageKey(result.code))
      : null;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="favorite" value={favorite ? 'off' : 'on'} />
      <div>
        <Button
          type="submit"
          variant={favorite ? 'dark' : 'secondary'}
          disabled={pending}
          aria-pressed={favorite}
          aria-label={favorite ? t('favorite.unstarNamed', { title }) : t('favorite.starNamed', { title })}
          icon={
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                fill={favorite ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          {favorite ? t('favorite.starred') : t('favorite.star')}
        </Button>
      </div>
      {conflict ? (
        <div ref={promptRef} tabIndex={-1} className="outline-none">
          <Alert tone="warning" title={t('favorite.conflictTitle')}>
            <ul className="m-0 flex list-disc flex-col gap-1 ps-5">
              {(result.conflicts ?? []).map((c) => (
                <li key={`${c.kind}:${c.title}`}>
                  {c.kind === 'enrolled'
                    ? t('favorite.conflictEnrolled', { title: c.title })
                    : t('favorite.conflictFavorite', { title: c.title })}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="submit" name="choice" value="keep_both" disabled={pending}>
                {t('favorite.keepBoth')}
              </Button>
              {result.replace ? (
                <Button type="submit" variant="secondary" name="choice" value="replace" disabled={pending}>
                  {t('favorite.replace')}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setDismissed(result.stamp)}>
                {t('favorite.cancel')}
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}
      {refusal ? <Alert title={refusal} /> : null}
      <p role="status" className="m-0 text-caption text-ink-2">
        {done}
      </p>
    </form>
  );
}
