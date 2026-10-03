'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

export interface SeatTarget {
  readonly value: string;
  readonly label: string;
}

/**
 * The bulk form's action picker, its inputs and its submit button: a label for label actions, a
 * subject and message for email, where to seat people for "Assign seats" (M1.8f). Only the fields
 * the chosen action uses are shown (and required). "Cancel tickets" can't be undone, so it asks
 * first in a dialog that names how many people it covers.
 */
export function BulkFields({
  canWrite,
  canExport,
  canSeat,
  canResend,
  canCancel,
  labelSuggestions,
  seatTargets,
  adaEnforced,
  matching,
  seatDates = [],
}: {
  canWrite: boolean;
  canExport: boolean;
  canSeat: boolean;
  canResend: boolean;
  canCancel: boolean;
  labelSuggestions: readonly string[];
  /** Tables, rows, sections and group blocks to seat people in (null: no plan). */
  seatTargets: readonly SeatTarget[] | null;
  /** An enforced accessibility rule keeps accessible seats back: offer the override. */
  adaEnforced: boolean;
  /** How many attendees "All matching" covers. */
  matching: number;
  /** Dates with their own seating chart (M1.7g): where "Assign seats" seats people. */
  seatDates?: readonly SeatTarget[];
}) {
  const t = useTranslations('bulk');
  const seats = canSeat && seatTargets !== null && seatTargets.length > 0;
  const [what, setWhat] = useState(
    canWrite ? 'addLabel' : seats ? 'assignSeats' : canExport ? 'export' : canCancel ? 'cancelTickets' : '',
  );
  const [count, setCount] = useState(0);
  const [nothing, setNothing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cls = 'field';

  function reviewCancel() {
    const form = box.current?.closest('form');
    if (!form) return;
    const fd = new FormData(form);
    const n = fd.get('scope') === 'all' ? matching : fd.getAll('ids').length;
    setCount(n);
    setNothing(n === 0);
    if (n > 0) dialog.current?.showModal();
  }

  return (
    <div ref={box} className="contents">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bulk-what" className="text-[13px] font-bold text-ink">
          {t('action')}
        </label>
        <select
          id="bulk-what"
          name="bulk"
          value={what}
          onChange={(e) => {
            setWhat(e.target.value);
            setNothing(false);
          }}
          className={cls}
        >
          {canWrite ? <option value="addLabel">{t('addLabel')}</option> : null}
          {canWrite ? <option value="removeLabel">{t('removeLabel')}</option> : null}
          {canWrite ? <option value="email">{t('email')}</option> : null}
          {seats ? <option value="assignSeats">{t('assignSeats')}</option> : null}
          {canResend ? <option value="resend">{t('resend')}</option> : null}
          {canExport ? <option value="export">{t('export')}</option> : null}
          {canCancel ? <option value="cancelTickets">{t('cancelTickets')}</option> : null}
        </select>
      </div>
      {what === 'addLabel' || what === 'removeLabel' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-label" className="text-[13px] font-bold text-ink">
            {t('label')}
          </label>
          <input
            id="bulk-label"
            name="bulkLabel"
            required
            maxLength={40}
            list="bulk-label-suggestions"
            autoComplete="off"
            className={cls}
          />
          <datalist id="bulk-label-suggestions">
            {labelSuggestions.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      ) : null}
      {what === 'email' ? (
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-subject" className="text-[13px] font-bold text-ink">
              {t('subject')}
            </label>
            <input id="bulk-subject" name="subject" required maxLength={150} className={cls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-message" className="text-[13px] font-bold text-ink">
              {t('message')}
            </label>
            <textarea
              id="bulk-message"
              name="message"
              required
              maxLength={5000}
              rows={5}
              aria-describedby="bulk-message-hint"
              className="rounded-card border border-line bg-surface px-4 py-3 text-body"
            />
            <span id="bulk-message-hint" className="text-caption text-ink-2">
              {t('messageHint')}
            </span>
          </div>
        </div>
      ) : null}
      {what === 'assignSeats' && seats ? (
        <>
          {seatDates.length ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bulk-date" className="text-[13px] font-bold text-ink">
                {t('seatDate')}
              </label>
              <select id="bulk-date" name="bulkDate" defaultValue="" className={cls}>
                <option value="">{t('seatDatePlan')}</option>
                {seatDates.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-target" className="text-[13px] font-bold text-ink">
              {t('target')}
            </label>
            <select
              id="bulk-target"
              name="bulkTarget"
              required
              defaultValue={seatTargets[0]?.value}
              aria-describedby="bulk-target-hint"
              className={cls}
            >
              {seatTargets.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {adaEnforced ? (
            <label className="flex min-h-6 items-center gap-2 self-center text-body">
              <input type="checkbox" name="overrideRules" className="size-5 accent-primary" />
              {t('overrideRules')}
            </label>
          ) : null}
          <p id="bulk-target-hint" className="w-full text-caption text-ink-2">
            {t('assignHint')}
          </p>
        </>
      ) : null}
      {what === 'resend' ? <p className="w-full text-caption text-ink-2">{t('resendHint')}</p> : null}
      {what === 'cancelTickets' ? (
        <>
          <p id="bulk-cancel-hint" className="w-full text-caption text-ink-2">
            {t('cancelHint')}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={reviewCancel}
            aria-describedby="bulk-cancel-hint"
          >
            {t('cancelReview')}
          </Button>
          {nothing ? (
            <p role="alert" className="w-full text-caption text-danger">
              {t('confirmCancel.none')}
            </p>
          ) : null}
          <dialog
            ref={dialog}
            aria-labelledby="bulk-cancel-title"
            aria-describedby="bulk-cancel-body"
            className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-6 text-ink elevation-pop backdrop:bg-scrim"
          >
            <div className="flex flex-col gap-4">
              <h2 id="bulk-cancel-title" className="text-section">
                {t('confirmCancel.title', { count })}
              </h2>
              <p id="bulk-cancel-body" className="text-body text-ink-2">
                {t('confirmCancel.body', { count })}
              </p>
              <input type="hidden" name="confirmCount" value={count} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" onClick={() => dialog.current?.close()}>
                  {t('confirmCancel.confirm', { count })}
                </Button>
                <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>
                  {t('confirmCancel.keep')}
                </Button>
              </div>
            </div>
          </dialog>
        </>
      ) : (
        <Button type="submit" variant="secondary">
          {t('apply')}
        </Button>
      )}
    </div>
  );
}
