'use client';

import { type BoardGroup, boardGroups, boardPages, matchGuestByName } from '@yayatoh/checkin-engine';
import { Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlaceText } from '@/components/scan-guests.tsx';
import { PinPad } from '@/components/scan-kiosk.tsx';
import type { ScanClient } from '@/scan/client.ts';

/** How long a kiosk answer stays on screen, and how long a board page shows. */
const RESULT_MS = 10_000;
const PAGE_MS = 15_000;

type KioskAnswer =
  | { readonly tone: 'ok'; readonly name: string; readonly places: string[]; readonly again: boolean }
  | { readonly tone: 'help'; readonly reason: 'no_match' | 'see_staff' };

/** The staff exit shared by the guest kiosk and the board (PIN checked on the device, offline too). */
function StaffExit({
  client,
  onExit,
  onClose,
}: {
  client: ScanClient;
  onExit: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations('scanKiosk');
  const [open, setOpen] = useState(false);
  return open ? (
    <PinPad
      pinHash={client.kiosk?.pinHash ?? ''}
      onCancel={() => {
        setOpen(false);
        onClose?.();
      }}
      onUnlock={onExit}
    />
  ) : (
    <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>
      {t('staffExit')}
    </Button>
  );
}

/**
 * The guest kiosk (M4.4b): a guest types their own full name and sees their table, and is checked
 * in. Only an exact full name finds a guest (one guest, not declined); anything else asks them to
 * see staff, so the kiosk can't be used to look through the guest list. Works offline from the
 * device's guest snapshot; arrivals sync later.
 */
export function GuestKioskScreen({
  client,
  version,
  afterCheckIn,
  onExit,
}: {
  client: ScanClient;
  version: number;
  afterCheckIn: () => void;
  onExit: () => void;
}) {
  const t = useTranslations('scanGuestKiosk');
  const placeText = usePlaceText();
  const input = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState<KioskAnswer | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (!answer) return;
    const clear = window.setTimeout(() => setAnswer(null), RESULT_MS);
    return () => window.clearTimeout(clear);
  }, [answer]);

  async function find(typed: string) {
    const snap = client.guests.view();
    const m = snap ? matchGuestByName(snap, typed) : ({ status: 'no_match' } as const);
    if (m.status !== 'found') {
      setAnswer({ tone: 'help', reason: m.status });
    } else {
      const fresh = await client.guests.checkIn(m.guest.id, 'kiosk', client.clockOffsetMs);
      setAnswer({
        tone: 'ok',
        name: m.guest.name ?? '',
        places: m.guest.places.map(placeText),
        again: !fresh,
      });
      if (fresh) afterCheckIn();
    }
    setSeq((n) => n + 1);
  }

  return (
    <div className="flex min-h-[80dvh] flex-col gap-8" data-kiosk="guests" data-version={version}>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-display">{t('welcome', { event: client.eventName ?? '' })}</h1>
        <p className="text-title text-ink-2">{t('subtitle')}</p>
      </header>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.current?.value ?? '';
          if (input.current) input.current.value = '';
          void find(value);
          input.current?.focus();
        }}
      >
        <label htmlFor="guest-kiosk-name" className="text-title">
          {t('nameLabel')}
        </label>
        <input
          ref={input}
          id="guest-kiosk-name"
          required
          // biome-ignore lint/a11y/noAutofocus: a kiosk exists to receive names.
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          aria-describedby="guest-kiosk-hint"
          className="min-h-20 w-full rounded-panel border-2 border-line-strong bg-surface px-6 text-center text-[28px]"
        />
        <p id="guest-kiosk-hint" className="text-center text-body text-ink-2">
          {t('nameHint')}
        </p>
        <div className="flex justify-center">
          <Button type="submit" className="min-h-16 min-w-48 text-title">
            {t('find')}
          </Button>
        </div>
      </form>
      <div role="status" aria-live="assertive" aria-atomic="true" key={seq}>
        {answer ? (
          <div
            data-kiosk-result={answer.tone}
            className={`flex flex-col items-center gap-3 rounded-panel border-4 px-8 py-10 text-center ${
              answer.tone === 'ok'
                ? 'border-success bg-success-soft text-success'
                : 'border-warning bg-warning-soft text-warning'
            }`}
          >
            {answer.tone === 'ok' ? (
              <>
                <p className="text-display">
                  {t(answer.again ? 'welcomeBack' : 'hello', { name: answer.name })}
                </p>
                {answer.places.length ? (
                  <p className="text-title" data-testid="kiosk-place">
                    {t('yourPlace', { places: answer.places.join(' · ') })}
                  </p>
                ) : (
                  <p className="text-title">{t('noPlace')}</p>
                )}
                <p className="text-body">{t(answer.again ? 'alreadyIn' : 'checkedIn')}</p>
              </>
            ) : (
              <p className="text-display">{t(answer.reason === 'see_staff' ? 'seeStaff' : 'noMatch')}</p>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-auto flex justify-end">
        <StaffExit client={client} onExit={onExit} onClose={() => input.current?.focus()} />
      </div>
    </div>
  );
}

/** Lines that fit a page: the screen's height in rows times its columns (1 phone, 2 tablet, 3 TV). */
function useLinesPerPage(): number {
  const [lines, setLines] = useState(24);
  useEffect(() => {
    const measure = () => {
      const cols = window.matchMedia('(min-width: 1280px)').matches
        ? 3
        : window.matchMedia('(min-width: 768px)').matches
          ? 2
          : 1;
      const rows = Math.max(6, Math.floor((window.innerHeight - 260) / 48));
      setLines(cols * rows);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return lines;
}

/**
 * The A–Z table board (M4.4b) on a TV or tablet: every seated guest by last name with their table,
 * a page at a time (the pages turn by themselves; staff can pause or turn them). Works offline
 * from the device's guest snapshot and follows it as the device syncs.
 */
export function TableBoardScreen({
  client,
  version,
  onExit,
}: {
  client: ScanClient;
  version: number;
  onExit: () => void;
}) {
  const t = useTranslations('scanBoard');
  const locale = useLocale();
  const placeText = usePlaceText();
  const lines = useLinesPerPage();
  const groups: BoardGroup[] = useMemo(() => {
    const snap = client.guests.view();
    return snap ? boardGroups(snap, locale) : [];
  }, [client, version, locale]);
  const pages = useMemo(() => boardPages(groups, lines), [groups, lines]);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = pages.length;
  const current = Math.min(page, Math.max(0, total - 1));

  useEffect(() => {
    if (paused || total < 2) return;
    const id = window.setInterval(() => setPage((p) => (p + 1) % total), PAGE_MS);
    return () => window.clearInterval(id);
  }, [paused, total]);

  return (
    <div className="flex min-h-[90dvh] flex-col gap-6" data-kiosk="board">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-display">{t('title')}</h1>
        <p className="text-title text-ink-2">{client.eventName ?? ''}</p>
      </header>
      {total === 0 ? (
        <p className="text-center text-title text-ink-2">{t('empty')}</p>
      ) : (
        <section
          aria-label={t('pageOf', { page: current + 1, total })}
          className="columns-1 gap-8 md:columns-2 xl:columns-3"
        >
          {pages[current]?.map((g) => (
            <div key={`${g.letter}-${g.entries[0]?.guestId}`} className="break-inside-avoid-column">
              <h2
                className="mt-2 border-b-2 border-line-strong text-title font-extrabold"
                data-board-letter={g.letter}
              >
                {g.letter}
              </h2>
              <ul className="m-0 list-none p-0">
                {g.entries.map((e) => (
                  <li
                    key={e.guestId}
                    className="flex items-baseline justify-between gap-4 py-2 text-[22px] leading-tight"
                    data-board-guest={e.name}
                  >
                    <span className="font-semibold">{e.name}</span>
                    <span className="shrink-0 text-ink-2">{e.places.map(placeText).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-2" data-testid="board-page">
          {total ? t('pageOf', { page: current + 1, total }) : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {total > 1 ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? t('resume') : t('pause')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => setPage((current + 1) % total)}
              >
                {t('next')}
              </Button>
            </>
          ) : null}
          <StaffExit client={client} onExit={onExit} />
        </div>
      </div>
    </div>
  );
}
