'use client';

import { STAFF_REASONS } from '@yayatoh/assistance/client';
import { Alert, Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { HelpRequest, ScanClient } from '@/scan/client.ts';
import { SlaTimer } from './assistance-sla.tsx';

/**
 * Help on the Scan PWA's staff screen (M3.3b): the event's open help requests, most urgent
 * first (take one for this device, start it, resolve it), and a form to ask for help from this
 * door (backup, a supervisor, medical, security, a device problem), tied to this device and the
 * entrance it scans at. Re-read when the assistance channel says something changed.
 */
export function StaffHelp({ client, refreshKey }: { client: ScanClient; refreshKey: number }) {
  const t = useTranslations('assistance');
  const [requests, setRequests] = useState<HelpRequest[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRequests(await client.helpRequests());
    setLoaded(true);
  }, [client]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const failure = (code: string) =>
    code === 'offline'
      ? t('scan.offline')
      : code === 'conflict' || code === 'invalid_state'
        ? t('changed')
        : t('failed');

  async function act(r: HelpRequest, action: 'take' | 'start' | 'resolve') {
    setBusy(`${r.id}:${action}`);
    setMessage(null);
    setError(null);
    const code = await client.helpAction(r.id, action);
    if (code) setError(failure(code));
    else
      setMessage(
        t(`done.${action}`, { title: t('title', { number: r.number, reason: t(`reason.${r.reason}`) }) }),
      );
    setBusy(null);
    await load();
  }

  const [reason, setReason] = useState<string>('backup');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  async function ask(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setMessage(null);
    setError(null);
    const r = await client.askForHelp({ reason, note });
    setSending(false);
    if ('code' in r) {
      setError(r.code === 'validation_failed' ? t('scan.invalid') : failure(r.code));
      return;
    }
    setNote('');
    setMessage(t('scan.sent', { number: r.number }));
    await load();
  }

  const where = (r: HelpRequest) =>
    [r.location, r.checkpoint, r.device ? t('fromDevice', { device: r.device }) : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <section aria-labelledby="staff-help" className="flex flex-col gap-2">
        <h2 id="staff-help" className="text-section">
          {t('scan.queueTitle')}
        </h2>
        {!loaded ? (
          <p className="text-body text-ink-2">{t('scan.loading')}</p>
        ) : requests === null ? (
          <p className="text-body text-ink-2">{t('scan.unavailable')}</p>
        ) : requests.length === 0 ? (
          <p className="text-body text-ink-2" data-testid="staff-help-empty">
            {t('scan.none')}
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('scan.queueTitle')}>
            {requests.map((r) => {
              const title = t('title', { number: r.number, reason: t(`reason.${r.reason}`) });
              return (
                <li
                  key={r.id}
                  data-request={r.number}
                  className={`flex flex-col gap-1 rounded-card border-2 px-4 py-3 ${r.priority === 'urgent' ? 'border-danger' : 'border-line'}`}
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 text-body">
                    <span className="font-medium">{title}</span>
                    <span className="text-caption text-ink-2">
                      {t(`priority.${r.priority}`)} · {r.mine ? t('mineState') : t(`state.${r.state}`)}
                    </span>
                    <SlaTimer dueAt={r.dueAt} running={r.state === 'new'} />
                  </span>
                  {r.guest ? (
                    <span className="text-caption text-ink-2">{t('guestLine', r.guest)}</span>
                  ) : null}
                  {where(r) ? <span className="text-caption text-ink-2">{where(r)}</span> : null}
                  {r.note ? <span className="text-body">{r.note}</span> : null}
                  <span className="flex flex-wrap gap-2 pt-1">
                    {r.state === 'new' || (!r.mine && r.state !== 'in_progress') ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => act(r, 'take')}
                        aria-label={t('takeLabel', { title })}
                      >
                        {t('take')}
                      </Button>
                    ) : null}
                    {r.mine && r.state === 'assigned' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => act(r, 'start')}
                        aria-label={t('startLabel', { title })}
                      >
                        {t('start')}
                      </Button>
                    ) : null}
                    {r.mine ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => act(r, 'resolve')}
                        aria-label={t('resolveLabel', { title })}
                      >
                        {t('resolve')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="staff-ask" className="flex flex-col gap-2">
        <h2 id="staff-ask" className="text-section">
          {t('scan.askTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('scan.askHint')}</p>
        <form onSubmit={ask} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-ask-reason" className="text-[13px] font-bold text-ink">
              {t('scan.reasonLabel')}
            </label>
            <Select
              id="staff-ask-reason"
              value={reason}
              onValueChange={(v) => setReason(v)}
              className="field"
            >
              {STAFF_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reason.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-ask-note" className="text-[13px] font-bold text-ink">
              {t('scan.noteLabel')}
            </label>
            <textarea
              id="staff-ask-note"
              value={note}
              maxLength={500}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              className="field w-full py-3 leading-relaxed"
            />
          </div>
          <Button type="submit" disabled={sending} className="self-start">
            {t('scan.send')}
          </Button>
        </form>
      </section>
      <div
        role="status"
        aria-live="polite"
        className="text-body font-medium"
        data-testid="staff-help-message"
      >
        {message}
      </div>
      {error ? <Alert title={error} /> : null}
    </>
  );
}
