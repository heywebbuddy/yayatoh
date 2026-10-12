'use client';

import { Button, EmptyState, StatusPill } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { LookupMatch, ScanClient } from '@/scan/client.ts';

/**
 * Find a ticket holder at the door by name, email or phone (agreement §8) when their QR code
 * won't scan: works offline from the device's downloaded list. Checking someone in scans their
 * short code, so duplicates, dates, zones and session doors follow the same rules as a scan.
 */
export function TicketLookupPanel({
  client,
  version,
  onCheckIn,
}: {
  client: ScanClient;
  /** Bumped after a scan or a sync: re-run the search so "Checked in" shows. */
  version: string;
  onCheckIn: (shortCode: string) => void;
}) {
  const t = useTranslations('scanLookup');
  const id = useId();
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ kind: string; matches: LookupMatch[] } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let live = true;
    void client.lookup(q).then((r) => {
      if (live) setFound(r);
    });
    return () => {
      live = false;
    };
  }, [client, query, version]);

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3" data-ticket-lookup>
      <h2 id={`${id}-title`} className="text-section">
        {t('title')}
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-q`} className="text-[13px] font-bold text-ink">
          {t('searchLabel')}
        </label>
        <input
          ref={field}
          id={`${id}-q`}
          type="search"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-q-hint`}
          onChange={(e) => setQuery(e.target.value)}
          className="field field-lg w-full"
        />
        <p id={`${id}-q-hint`} className="text-caption text-ink-2">
          {t('searchHint')}
        </p>
      </div>
      <div aria-live="polite">
        {!found ? null : found.matches.length === 0 ? (
          <EmptyState
            title={t('noMatchTitle')}
            description={t(found.kind === 'name' ? 'noMatchName' : 'noMatchContact')}
            action={
              <Button type="button" variant="secondary" onClick={() => field.current?.select()}>
                {t('searchAgain')}
              </Button>
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('results')}>
            {found.matches.map((m) => (
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
                {m.status === 'void' ? (
                  <StatusPill tone="danger" label={t('void')} />
                ) : m.admittedHere ? (
                  <StatusPill tone="success" label={t('checkedIn')} />
                ) : (
                  <Button
                    type="button"
                    className="min-h-11"
                    aria-label={t('checkInNamed', { name: m.holderName })}
                    onClick={() => onCheckIn(m.shortCode)}
                  >
                    {t('checkIn')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
