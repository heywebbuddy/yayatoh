'use client';

import { Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { ScanState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { SignalBanner } from './signal-banner.tsx';

const TONE = {
  admitted: 'border-success bg-success-soft text-success',
  duplicate: 'border-warning bg-warning-soft text-warning',
  not_today: 'border-warning bg-warning-soft text-warning',
  wrong_date: 'border-warning bg-warning-soft text-warning',
  outside_window: 'border-warning bg-warning-soft text-warning',
  invalid: 'border-danger bg-danger-soft text-danger',
  void: 'border-danger bg-danger-soft text-danger',
  wrong_event: 'border-danger bg-danger-soft text-danger',
  duplicate_offline: 'border-danger bg-danger-soft text-danger',
  superseded: 'border-danger bg-danger-soft text-danger',
  provisional: 'border-primary bg-primary-soft text-primary-ink',
  granted: 'border-success bg-success-soft text-success',
  no_access: 'border-danger bg-danger-soft text-danger',
  wrong_checkpoint: 'border-danger bg-danger-soft text-danger',
  balance_due: 'border-warning bg-warning-soft text-warning',
  // M5.6a session doors.
  entered: 'border-success bg-success-soft text-success',
  scanned_out: 'border-success bg-success-soft text-success',
  not_in_room: 'border-warning bg-warning-soft text-warning',
  not_enrolled: 'border-danger bg-danger-soft text-danger',
  admission_level: 'border-danger bg-danger-soft text-danger',
  capacity: 'border-warning bg-warning-soft text-warning',
} as const;

/** M5.6a: the gate behind a session door's refusal (staff may override it, with a reason). */
const GATE_OF: Partial<Record<keyof typeof TONE, 'enrollment' | 'admission_level' | 'capacity'>> = {
  not_enrolled: 'enrollment',
  admission_level: 'admission_level',
  capacity: 'capacity',
};

const newScanId = () => `web:${crypto.randomUUID()}`;
/** The door screen's presence ping (the check-in module's `PRESENCE_PING_MS`). */
const PRESENCE_PING_MS = 30_000;

/**
 * The code field keeps focus, so USB/Bluetooth scanners (which type the code and press Enter)
 * and people typing a short code use the same path. The result is announced politely.
 */
export function Scanner({
  action,
  timeZone,
  checkpoints,
  scoped = false,
  presenceUrl,
}: {
  action: (prev: ScanState, form: FormData) => Promise<ScanState>;
  /** M3.3a staff presence: where to tell the Command Center this member is at the doors. */
  presenceUrl?: string;
  timeZone: string;
  /** Live entrances, zones and session doors; the choice stays put between scans. */
  checkpoints: readonly { id: string; name: string; kind?: string }[];
  /** Checkpoint-scoped door staff: only their checkpoints, no "whole event"; they must pick one. */
  scoped?: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const [checkpointId, setCheckpointId] = useState('');
  const stand = checkpoints.some((c) => c.id === checkpointId) ? checkpointId : '';
  const sessionDoor = checkpoints.find((c) => c.id === stand)?.kind === 'session';
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  /** Gates already waived for the person on screen (an override may meet the next gate). */
  const [waived, setWaived] = useState<string[]>([]);
  const [scanId, setScanId] = useState(newScanId);
  const input = useRef<HTMLInputElement>(null);
  // While the door screen is open, report presence soon, every 30 s and when the entrance changes.
  // A plain request (not a server action), so it never interleaves with the scan form's action.
  useEffect(() => {
    if (!presenceUrl) return;
    const ping = () =>
      void fetch(presenceUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkpointId: stand || null }),
      }).catch(() => undefined);
    const first = setTimeout(ping, 1_000);
    const id = setInterval(ping, PRESENCE_PING_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [presenceUrl, stand]);
  useEffect(() => {
    if (state.kind === 'idle') return;
    // A refusal right after an override keeps what was waived; anything else starts afresh.
    if (state.kind !== 'outcome' || !state.override || !GATE_OF[state.outcome.result]) setWaived([]);
    else setWaived(state.override);
    setScanId(newScanId());
    if (input.current) {
      input.current.value = '';
      input.current.focus();
    }
  }, [state]);
  const time = (d: Date) =>
    new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);

  return (
    <div className="flex flex-col gap-4">
      {checkpoints.length > 0 || scoped ? (
        <div className="flex flex-col gap-1.5 self-start">
          <label htmlFor="scan-checkpoint" className="text-[13px] font-bold text-ink">
            {t('checkpoints.scanningAt')}
          </label>
          <Select
            id="scan-checkpoint"
            value={stand}
            onValueChange={(v) => {
              setCheckpointId(v);
              input.current?.focus();
            }}
            className="field"
          >
            <option value="">{scoped ? t('checkpoints.chooseStand') : t('checkpoints.wholeEvent')}</option>
            {checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {sessionDoor ? (
        <fieldset className="flex flex-col gap-1.5 self-start">
          <legend className="text-[13px] font-bold text-ink">{t('sessionCheckin.direction')}</legend>
          <div className="flex gap-2">
            {(['in', 'out'] as const).map((d) => (
              <label
                key={d}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-line-strong bg-surface px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="radio"
                  name="scan-direction"
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                />
                {t(d === 'in' ? 'sessionCheckin.scanIn' : 'sessionCheckin.scanOut')}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="scanId" value={scanId} />
        <input type="hidden" name="checkpointId" value={stand} />
        {sessionDoor ? <input type="hidden" name="direction" value={direction} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="scan-code" className="text-[13px] font-bold text-ink">
            {t('checkin.codeLabel')}
          </label>
          <input
            ref={input}
            id="scan-code"
            name="code"
            required
            // biome-ignore lint/a11y/noAutofocus: the door screen exists to receive scans.
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="scan-code-hint"
            className="min-h-14 w-full rounded-pill border border-line-strong bg-surface px-5 font-mono text-[18px] tracking-[0.08em]"
          />
          <p id="scan-code-hint" className="text-caption text-ink-2">
            {t('checkin.codeHint')}
          </p>
        </div>
        <Button type="submit" disabled={pending} className="min-h-14">
          {t('checkin.check')}
        </Button>
      </form>
      <div role="status" aria-live="polite" aria-atomic="true">
        {state.kind === 'outcome' ? (
          <div
            data-result={state.outcome.result}
            className={`flex flex-col gap-1 rounded-panel border-2 px-6 py-5 ${TONE[state.outcome.result]}`}
          >
            <p className="text-[28px] leading-tight font-medium tracking-[-0.02em]">
              {t(`checkin.result.${state.outcome.result}`)}
            </p>
            {state.outcome.result === 'wrong_checkpoint' ? (
              <p className="text-body">
                {checkpoints.length > 0
                  ? t('checkin.wrongCheckpointHint', { places: checkpoints.map((c) => c.name).join(', ') })
                  : t('checkin.noCheckpointsHint')}
              </p>
            ) : null}
            {state.outcome.ticket ? (
              <p className="text-body">
                {t('checkin.who', {
                  name: state.outcome.ticket.holderName,
                  pass: state.outcome.ticket.typeName,
                  serial: state.outcome.ticket.serial,
                })}
              </p>
            ) : null}
            {state.outcome.firstAdmittedAt ? (
              <p className="text-body">
                {t('checkin.firstAt', { time: time(state.outcome.firstAdmittedAt) })}
              </p>
            ) : null}
            {typeof state.outcome.dwellMs === 'number' ? (
              <p className="text-body">
                {t('sessionCheckin.dwell', { minutes: Math.round(state.outcome.dwellMs / 60_000) })}
              </p>
            ) : null}
            {GATE_OF[state.outcome.result] ? (
              <p className="text-body">{t(`sessionCheckin.gateHint.${GATE_OF[state.outcome.result]}`)}</p>
            ) : null}
            <SignalBanner count={state.outcome.openSignals} />
            {state.outcome.result === 'balance_due' ? (
              <p className="text-body">{t('checkin.balanceDueHint')}</p>
            ) : null}
          </div>
        ) : state.kind === 'error' ? (
          <div className={`rounded-panel border-2 px-6 py-5 ${TONE.invalid}`}>
            <p className="text-body">
              {state.code === 'override_note'
                ? t('checkin.overrideNoteRequired')
                : state.code === 'session_reason'
                  ? t('sessionCheckin.reasonRequired')
                  : state.code === 'nothing_to_override'
                    ? t('sessionCheckin.nothingToOverride')
                    : t(errorMessageKey(state.code))}
            </p>
          </div>
        ) : null}
      </div>
      {/* M5.1d: a balance is due on the invoice; staff may admit anyway, with a reason (audited). */}
      {state.kind === 'outcome' && state.outcome.result === 'balance_due' && state.outcome.ticket ? (
        <form
          action={formAction}
          aria-label={t('checkin.overrideLabel')}
          className="flex flex-col gap-3 rounded-panel border border-line p-4"
        >
          <input type="hidden" name="intent" value="override" />
          <input type="hidden" name="code" value={state.outcome.ticket.shortCode} />
          <input type="hidden" name="checkpointId" value={stand} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="scan-override-note" className="text-caption text-ink-2">
              {t('checkin.overrideNote')}
            </label>
            <input
              id="scan-override-note"
              name="note"
              required
              minLength={3}
              maxLength={300}
              autoComplete="off"
              aria-describedby="scan-override-hint"
              className="min-h-10 w-full rounded-pill border border-line-strong bg-surface px-4 text-body"
            />
            <p id="scan-override-hint" className="text-caption text-ink-2">
              {t('checkin.overrideHint')}
            </p>
          </div>
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {t('checkin.overrideSubmit')}
          </Button>
        </form>
      ) : null}
      {/* M5.6a: a session door's gate refused; staff may let them in anyway, with a reason (audited). */}
      {state.kind === 'outcome' && GATE_OF[state.outcome.result] && state.outcome.ticket ? (
        <form
          action={formAction}
          noValidate
          aria-label={t('sessionCheckin.overrideLabel')}
          className="flex flex-col gap-3 rounded-panel border border-line p-4"
        >
          <input type="hidden" name="intent" value="session_override" />
          <input type="hidden" name="code" value={state.outcome.ticket.shortCode} />
          <input type="hidden" name="checkpointId" value={stand} />
          <input
            type="hidden"
            name="gates"
            value={[...new Set([...waived, GATE_OF[state.outcome.result] ?? ''])].join(',')}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="scan-session-reason" className="text-caption text-ink-2">
              {t('sessionCheckin.overrideReason')}
            </label>
            <input
              id="scan-session-reason"
              name="note"
              required
              minLength={3}
              maxLength={300}
              autoComplete="off"
              aria-describedby="scan-session-reason-hint"
              className="min-h-10 w-full rounded-pill border border-line-strong bg-surface px-4 text-body"
            />
            <p id="scan-session-reason-hint" className="text-caption text-ink-2">
              {t('sessionCheckin.overrideHint')}
            </p>
          </div>
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {t('sessionCheckin.overrideSubmit')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
