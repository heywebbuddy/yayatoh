'use client';

import { Button, EmptyState, StatusPill } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState, useTransition } from 'react';
import type { LookupState, ScanState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * Find a ticket holder by name, email or phone (agreement §8) at the console's door screen, and
 * check them in: the check-in is an ordinary scan of their short code, so duplicates, dates and
 * checkpoints follow the same rules as the scanner beside it.
 */
export function HolderLookup({
  find,
  scan,
}: {
  find: (prev: LookupState, form: FormData) => Promise<LookupState>;
  scan: (prev: ScanState, form: FormData) => Promise<ScanState>;
}) {
  const t = useTranslations();
  const id = useId();
  const [state, search, searching] = useActionState(find, { kind: 'idle' });
  const [checked, setChecked] = useState<Readonly<Record<string, string>>>({});
  const [pending, start] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  const checkIn = (ticketId: string, code: string) =>
    start(async () => {
      const form = new FormData();
      form.set('code', code);
      form.set('scanId', `web:${crypto.randomUUID()}`);
      const r = await scan({ kind: 'idle' }, form);
      setChecked((c) => ({
        ...c,
        [ticketId]:
          r.kind === 'outcome'
            ? t(`checkin.result.${r.outcome.result}`)
            : t(errorMessageKey(r.kind === 'error' ? r.code : 'internal')),
      }));
    });

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3" data-holder-lookup>
      <h2 id={`${id}-title`} className="text-section">
        {t('scanLookup.title')}
      </h2>
      <form action={search} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <label htmlFor={`${id}-q`} className="text-[13px] font-bold text-ink">
            {t('scanLookup.searchLabel')}
          </label>
          <input
            ref={field}
            id={`${id}-q`}
            name="query"
            type="search"
            required
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-q-hint`}
            className="field w-full"
          />
          <p id={`${id}-q-hint`} className="text-caption text-ink-2">
            {t('scanLookup.consoleHint')}
          </p>
        </div>
        <Button type="submit" variant="secondary" disabled={searching}>
          {t('scanLookup.search')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'error' ? (
          <p className="text-body text-danger">{t(errorMessageKey(state.code))}</p>
        ) : state.kind === 'found' && state.matches.length === 0 ? (
          <EmptyState
            title={t('scanLookup.noMatchTitle')}
            description={t(state.lookup === 'name' ? 'scanLookup.noMatchName' : 'scanLookup.noMatchContact')}
            action={
              <Button type="button" variant="secondary" onClick={() => field.current?.select()}>
                {t('scanLookup.searchAgain')}
              </Button>
            }
          />
        ) : state.kind === 'found' ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('scanLookup.results')}>
            {state.matches.map((m) => (
              <li
                key={m.ticketId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line px-4 py-3"
                data-holder={m.holderName}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-body font-medium">{m.holderName}</span>
                  <span className="text-caption text-ink-2">
                    {m.typeName} · <span className="font-mono">{m.shortCode}</span>
                  </span>
                </div>
                {checked[m.ticketId] ? (
                  <p role="status" className="text-body font-semibold">
                    {checked[m.ticketId]}
                  </p>
                ) : m.status === 'void' ? (
                  <StatusPill tone="danger" label={t('scanLookup.void')} />
                ) : m.admittedToday ? (
                  <StatusPill tone="success" label={t('scanLookup.checkedIn')} />
                ) : (
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={pending}
                    aria-label={t('scanLookup.checkInNamed', { name: m.holderName })}
                    onClick={() => checkIn(m.ticketId, m.shortCode)}
                  >
                    {t('scanLookup.checkIn')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
