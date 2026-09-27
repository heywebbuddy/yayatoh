'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { ScanState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const TONE = {
  admitted: 'border-green-600 bg-green-50 text-green-900',
  duplicate: 'border-accent-700 bg-accent-50 text-accent-text',
  not_today: 'border-accent-700 bg-accent-50 text-accent-text',
  outside_window: 'border-accent-700 bg-accent-50 text-accent-text',
  invalid: 'border-pink-700 bg-pink-50 text-pink-700',
  void: 'border-pink-700 bg-pink-50 text-pink-700',
  wrong_event: 'border-pink-700 bg-pink-50 text-pink-700',
  duplicate_offline: 'border-pink-700 bg-pink-50 text-pink-700',
  superseded: 'border-pink-700 bg-pink-50 text-pink-700',
  provisional: 'border-accent-700 bg-accent-50 text-accent-text',
  granted: 'border-green-600 bg-green-50 text-green-900',
  no_access: 'border-pink-700 bg-pink-50 text-pink-700',
  wrong_checkpoint: 'border-pink-700 bg-pink-50 text-pink-700',
} as const;

const newScanId = () => `web:${crypto.randomUUID()}`;

/**
 * The code field keeps focus, so USB/Bluetooth scanners (which type the code and press Enter)
 * and people typing a short code use the same path. The result is announced politely.
 */
export function Scanner({
  action,
  timeZone,
  checkpoints,
  scoped = false,
}: {
  action: (prev: ScanState, form: FormData) => Promise<ScanState>;
  timeZone: string;
  /** Live entrances and zones; the choice stays put between scans. */
  checkpoints: readonly { id: string; name: string }[];
  /** Checkpoint-scoped door staff: only their checkpoints, no "whole event"; they must pick one. */
  scoped?: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const [checkpointId, setCheckpointId] = useState('');
  const stand = checkpoints.some((c) => c.id === checkpointId) ? checkpointId : '';
  const [scanId, setScanId] = useState(newScanId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.kind === 'idle') return;
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
          <label htmlFor="scan-checkpoint" className="text-caption text-zinc-600">
            {t('checkpoints.scanningAt')}
          </label>
          <select
            id="scan-checkpoint"
            value={stand}
            onChange={(e) => {
              setCheckpointId(e.target.value);
              input.current?.focus();
            }}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          >
            <option value="">{scoped ? t('checkpoints.chooseStand') : t('checkpoints.wholeEvent')}</option>
            {checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="scanId" value={scanId} />
        <input type="hidden" name="checkpointId" value={stand} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="scan-code" className="text-caption text-zinc-600">
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
            className="min-h-14 w-full rounded-pill border border-zinc-300 bg-white px-5 font-mono text-[18px] tracking-[0.08em]"
          />
          <p id="scan-code-hint" className="text-caption text-zinc-500">
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
          </div>
        ) : state.kind === 'error' ? (
          <div className={`rounded-panel border-2 px-6 py-5 ${TONE.invalid}`}>
            <p className="text-body">{t(errorMessageKey(state.code))}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
