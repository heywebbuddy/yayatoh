'use client';

import { captureState } from '@yayatoh/leads/rules';
import { Alert, Button, Card, Checkbox, cx, Radio, StatusPill, Tabs, tabClass } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { canUseCamera } from '@/scan/camera.ts';
import { LeadClient, LeadOffline, LeadRefused, type LeadSetup, LeadSignedOut } from '@/scan/lead-client.ts';
import { type LeadView, matchesLead, type ScanResultView } from '@/scan/lead-queue.ts';
import { useCameraScan } from '@/scan/use-camera.ts';

type Phase = 'boot' | 'signed_out' | 'ready';
type View = 'scan' | 'leads';
type Rating = LeadView['rating'];

/** The last scan on this device: waiting in the queue, or the server's answer. */
interface Last {
  readonly scanId: string;
  readonly result: ScanResultView | null;
}

/**
 * Lead mode of the Scan PWA (M5.6b): an exhibitor's licensed person scans badge QRs (or types
 * the code under the QR). Scans are queued on the device and synced when online; each shows the
 * P5-8 allowlist once synced (name, job title, company, email only with consent). Rating,
 * qualifiers and notes go with a queued scan or save to a synced lead. The person comes from the
 * portal session; signing out (or a revoked account) wipes this device's lead data.
 */
export function LeadApp() {
  const t = useTranslations('leads.app');
  const tl = useTranslations('leads');
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>('boot');
  const client = useRef<LeadClient | null>(null);
  const [setup, setSetup] = useState<LeadSetup | null>(null);
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [scope, setScope] = useState<'all' | 'team' | 'own'>('own');
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [view, setView] = useState<View>('scan');
  const [camera, setCamera] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const show = useCallback(async (c: LeadClient) => {
    setSetup(c.setup);
    setLeads([...c.leads]);
    setScope(c.scope);
    setQueued((await c.queue()).length);
  }, []);

  const explain = useCallback(
    (err: unknown) => {
      if (err instanceof LeadRefused) {
        const key = `refusals.${err.reason ?? err.code}`;
        setProblem(t.has(key) ? t(key) : t('refusals.other'));
      } else setProblem(t('refusals.other'));
    },
    [t],
  );

  /** Push the queue, then read the setup and leads again. */
  const sync = useCallback(
    async (c: LeadClient): Promise<Map<string, ScanResultView> | null> => {
      let results: Map<string, ScanResultView> | null = null;
      try {
        results = await c.flush();
        await c.refresh();
        setOnline(true);
        setProblem(null);
      } catch (err) {
        if (err instanceof LeadSignedOut) setPhase('signed_out');
        else if (err instanceof LeadOffline) setOnline(false);
        else {
          setOnline(true);
          explain(err);
        }
      }
      await show(c);
      setNow(new Date());
      return results;
    },
    [explain, show],
  );

  // Boot: what this device kept, then the server.
  useEffect(() => {
    setHasCamera(canUseCamera());
    const c = new LeadClient(locale);
    client.current = c;
    void (async () => {
      await c.load();
      try {
        await c.refresh();
        setOnline(true);
      } catch (err) {
        if (err instanceof LeadSignedOut) {
          setPhase('signed_out');
          return;
        }
        setOnline(false);
      }
      if (!c.setup) {
        setPhase('signed_out');
        return;
      }
      await show(c);
      setPhase('ready');
      void sync(c);
    })();
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/scan-sw.js').catch(() => undefined);
  }, [locale, show, sync]);

  // Back online: flush; and every 30 s.
  useEffect(() => {
    if (phase !== 'ready') return;
    const c = client.current;
    if (!c) return;
    const tick = () => void sync(c);
    const id = window.setInterval(tick, 30_000);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', tick);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', tick);
      window.removeEventListener('offline', onOffline);
    };
  }, [phase, sync]);

  const scan = useCallback(
    async (code: string) => {
      const c = client.current;
      if (!c || !code.trim()) return;
      const s = await c.scan(code, navigator.onLine);
      setLast({ scanId: s.scanId, result: null });
      await show(c);
      if (navigator.onLine) {
        const results = await sync(c);
        const r = results?.get(s.scanId);
        if (r) setLast({ scanId: s.scanId, result: r });
      }
    },
    [show, sync],
  );

  const onCameraError = useCallback(() => {
    setCamera(false);
    setProblem(t('cameraFailed'));
  }, [t]);
  useCameraScan(camera, video, scan, onCameraError);

  if (phase === 'boot') return <p className="text-body text-ink-2">{t('loading')}</p>;

  if (phase === 'signed_out' || !setup)
    return (
      <section aria-labelledby="leads-signed-out" className="flex flex-col gap-4">
        <h1 id="leads-signed-out" className="text-title">
          {t('signedOutTitle')}
        </h1>
        <p className="text-body text-ink-2">{t('signedOutDescription')}</p>
        <a
          href={`${locale === 'en' ? '' : `/${locale}`}/event-portal`}
          className="inline-flex min-h-11 items-center self-start font-semibold text-primary-ink underline underline-offset-4"
        >
          {t('openPortal')}
        </a>
      </section>
    );

  const when = new Intl.DateTimeFormat(locale, {
    timeZone: setup.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const window_ = {
    opensAt: new Date(setup.capture.opensAt),
    closesAt: new Date(setup.capture.closesAt),
    accessUntil: new Date(setup.capture.accessUntil),
  };
  const state = captureState(window_, now);
  const blocked =
    setup.license !== 'licensed'
      ? t(`blocked.${setup.license}`)
      : !setup.termsAccepted
        ? t(setup.role === 'exhibitor_admin' ? 'blocked.termsAdmin' : 'blocked.termsStaff')
        : state === 'not_open'
          ? t('blocked.notOpen', { time: when.format(window_.opensAt) })
          : state === 'closed'
            ? t('blocked.closed', { time: when.format(window_.closesAt) })
            : null;

  const lastLead = last?.result?.lead ?? null;
  const views: { key: View; label: string }[] = [
    { key: 'scan', label: t('viewScan') },
    { key: 'leads', label: t('viewLeads', { count: leads.length }) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">{t('title', { exhibitor: setup.exhibitorName })}</h1>
        <p className="text-body text-ink-2">{setup.eventName}</p>
        <p className="flex flex-wrap gap-x-3 text-caption text-ink-2" aria-live="polite">
          <span data-testid="leads-network">{online ? t('online') : t('offline')}</span>
          <span data-testid="leads-queue">{t('queued', { count: queued })}</span>
          <span>{setup.email}</span>
        </p>
      </header>
      {problem ? <Alert tone="danger" title={problem} /> : null}
      <Tabs label={t('modes')}>
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
            className={cx(tabClass(view === v.key), 'min-h-12 grow justify-center text-[15px]')}
          >
            {v.label}
          </button>
        ))}
      </Tabs>

      {view === 'scan' ? (
        <div className="flex flex-col gap-4">
          {blocked ? (
            <Alert tone="warning" title={t('blockedTitle')}>
              <p className="m-0">{blocked}</p>
            </Alert>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const value = input.current?.value ?? '';
                if (input.current) input.current.value = '';
                void scan(value);
                input.current?.focus();
              }}
            >
              <div className="flex min-w-0 flex-1 basis-full flex-col gap-1.5 sm:basis-64">
                <label htmlFor="lead-code" className="text-[13px] font-bold text-ink">
                  {t('codeLabel')}
                </label>
                <input
                  ref={input}
                  id="lead-code"
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-describedby="lead-code-hint"
                  className="field field-lg w-full font-mono tracking-[0.08em]"
                />
                <p id="lead-code-hint" className="text-caption text-ink-2">
                  {t('codeHint')}
                </p>
              </div>
              <Button type="submit" size="lg" className="flex-1 sm:flex-none">
                {t('save')}
              </Button>
              {hasCamera ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="flex-1 sm:flex-none"
                  onClick={() => setCamera((v) => !v)}
                >
                  {camera ? t('stopCamera') : t('camera')}
                </Button>
              ) : null}
            </form>
          )}
          {camera && !blocked ? (
            <video
              ref={video}
              className="aspect-video w-full max-w-md rounded-card bg-black"
              playsInline
              muted
            />
          ) : null}
          <div role="status" aria-live="polite" aria-atomic="true">
            {last ? <ScanResult last={last} timeZone={setup.timezone} /> : null}
          </div>
          {last && (last.result === null || lastLead) && client.current ? (
            <LeadEditor
              key={`${last.scanId}:${lastLead?.id ?? ''}`}
              idPrefix="last"
              qualifiers={setup.qualifiers}
              lead={lastLead}
              online={online}
              onSave={async (edits) => {
                const c = client.current;
                if (!c) return 'failed';
                if (lastLead) {
                  try {
                    await c.update(lastLead.id, edits);
                  } catch (err) {
                    if (err instanceof LeadOffline) return 'offline';
                    explain(err);
                    return 'failed';
                  }
                  await show(c);
                  return 'saved';
                }
                return (await c.editQueued(last.scanId, edits)) ? 'queued' : 'failed';
              }}
            />
          ) : null}
        </div>
      ) : (
        <LeadList
          leads={leads}
          scope={scope}
          setup={setup}
          online={online}
          accessEnded={!setup.capture.accessOpen}
          onSave={async (leadId, edits) => {
            const c = client.current;
            if (!c) return 'failed';
            try {
              await c.update(leadId, edits);
            } catch (err) {
              if (err instanceof LeadOffline) return 'offline';
              explain(err);
              return 'failed';
            }
            await show(c);
            return 'saved';
          }}
        />
      )}
      <p className="text-caption text-ink-2">
        {tl('portal.window', {
          opens: when.format(window_.opensAt),
          closes: when.format(window_.closesAt),
          until: when.format(window_.accessUntil),
        })}
      </p>
    </div>
  );
}

function ScanResult({ last, timeZone }: { last: Last; timeZone: string }) {
  const t = useTranslations('leads.app');
  const r = last.result;
  if (!r)
    return (
      <Card className="flex flex-col gap-1.5 border-2 border-primary" data-result="queued">
        <p className="m-0 text-[24px] leading-tight font-extrabold">{t('result.queued')}</p>
        <p className="m-0 text-body">{t('result.queuedHint')}</p>
      </Card>
    );
  if (r.status === 'refused')
    return (
      <Card className="flex flex-col gap-1.5 border-2 border-danger bg-danger-soft" data-result="refused">
        <p className="m-0 text-[24px] leading-tight font-extrabold text-danger">{t('result.refused')}</p>
        <p className="m-0 text-body">{t(`reasons.${r.reason ?? 'invalid'}`)}</p>
      </Card>
    );
  const l = r.lead;
  return (
    <Card className="flex flex-col gap-1.5 border-2 border-success bg-success-soft" data-result={r.status}>
      <p className="m-0 text-[24px] leading-tight font-extrabold text-success">{t(`result.${r.status}`)}</p>
      {l ? <LeadFields lead={l} timeZone={timeZone} /> : null}
    </Card>
  );
}

/** The P5-8 allowlist of a lead, and the stamp of what was shared. */
function LeadFields({ lead, timeZone }: { lead: LeadView; timeZone: string }) {
  const t = useTranslations('leads.app');
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const role = [lead.jobTitle, lead.company].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-section text-ink">{lead.name}</p>
      {role ? <p className="m-0 text-body">{role}</p> : null}
      <p className="m-0 text-body">
        {lead.email
          ? lead.email
          : lead.emailWithdrawnAt
            ? t('emailWithdrawn', { time: when.format(new Date(lead.emailWithdrawnAt)) })
            : t('emailNotShared')}
      </p>
      <p className="m-0 text-caption text-ink-2">
        {t('capturedAt', { time: when.format(new Date(lead.capturedAt)), count: lead.scans })}
        {lead.scannedBy ? ` · ${t('scannedBy', { email: lead.scannedBy })}` : ''}
      </p>
    </div>
  );
}

type SaveOutcome = 'saved' | 'queued' | 'offline' | 'failed';

/** Rating (radio group), qualifiers (checkboxes) and notes: all keyboard-operable controls. */
function LeadEditor({
  idPrefix,
  qualifiers,
  lead,
  online,
  onSave,
}: {
  idPrefix: string;
  qualifiers: readonly string[];
  lead: LeadView | null;
  online: boolean;
  onSave: (edits: { rating: Rating; qualifiers: string[]; notes: string }) => Promise<SaveOutcome>;
}) {
  const t = useTranslations('leads.app');
  const uid = useId();
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const notesId = `${idPrefix}-${uid}-notes`;
  return (
    <form
      className="flex flex-col gap-3"
      aria-label={t('editLabel')}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const rating = String(f.get('rating') ?? '');
        setPending(true);
        void onSave({
          rating: rating === 'hot' || rating === 'warm' || rating === 'cold' ? rating : null,
          qualifiers: f.getAll('qualifiers').map(String),
          notes: String(f.get('notes') ?? ''),
        })
          .then(setOutcome)
          .finally(() => setPending(false));
      }}
    >
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('rating')}</legend>
        <div className="flex flex-wrap gap-x-4">
          {(['hot', 'warm', 'cold', ''] as const).map((r) => (
            <Radio
              key={r || 'none'}
              id={`${idPrefix}-${uid}-rating-${r || 'none'}`}
              name="rating"
              value={r}
              defaultChecked={(lead?.rating ?? '') === r}
              label={t(`ratings.${r || 'none'}`)}
            />
          ))}
        </div>
      </fieldset>
      {qualifiers.length > 0 ? (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-[13px] font-bold text-ink">{t('qualifiers')}</legend>
          <div className="flex flex-wrap gap-x-4">
            {qualifiers.map((q, i) => (
              <Checkbox
                key={q}
                id={`${idPrefix}-${uid}-q-${i}`}
                name="qualifiers"
                value={q}
                defaultChecked={lead?.qualifiers.includes(q) ?? false}
                label={q}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={notesId} className="text-[13px] font-bold text-ink">
          {t('notes')}
        </label>
        <textarea
          id={notesId}
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={lead?.notes ?? ''}
          className="rounded-card border bg-surface px-4 py-2 text-body"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" variant="secondary" disabled={pending}>
          {t('saveDetails')}
        </Button>
        <span aria-live="polite" className="text-caption">
          {outcome === 'saved'
            ? t('saved')
            : outcome === 'queued'
              ? t('savedQueued')
              : outcome === 'offline' || (outcome === null && lead && !online)
                ? t('needsConnection')
                : outcome === 'failed'
                  ? t('saveFailed')
                  : null}
        </span>
      </div>
    </form>
  );
}

function LeadList({
  leads,
  scope,
  setup,
  online,
  accessEnded,
  onSave,
}: {
  leads: LeadView[];
  scope: 'all' | 'team' | 'own';
  setup: LeadSetup;
  online: boolean;
  accessEnded: boolean;
  onSave: (
    leadId: string,
    edits: { rating: Rating; qualifiers: string[]; notes: string },
  ) => Promise<SaveOutcome>;
}) {
  const t = useTranslations('leads.app');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (accessEnded) return <Alert tone="info" title={t('accessEnded')} />;
  const shown = leads.filter((l) => matchesLead(l, query));
  return (
    <section aria-labelledby="leads-list-heading" className="flex flex-col gap-3">
      <h2 id="leads-list-heading" className="text-section">
        {t(`scope.${scope}`, { exhibitor: setup.exhibitorName })}
      </h2>
      {leads.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="m-0 text-body font-bold">{t('emptyTitle')}</p>
          <p className="m-0 text-body text-ink-2">{t('emptyDescription')}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-search" className="text-[13px] font-bold text-ink">
              {t('search')}
            </label>
            <input
              id="lead-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field field-lg w-full"
            />
          </div>
          {shown.length === 0 ? <p className="text-body text-ink-2">{t('noMatch')}</p> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((l) => (
              <li key={l.id}>
                <Card className="flex flex-col gap-2">
                  <LeadFields lead={l} timeZone={setup.timezone} />
                  <p className="m-0 flex flex-wrap items-center gap-2">
                    {l.rating ? (
                      <StatusPill
                        tone={l.rating === 'hot' ? 'danger' : l.rating === 'warm' ? 'waiting' : 'info'}
                        label={t(`ratings.${l.rating}`)}
                      />
                    ) : null}
                    {l.qualifiers.map((q) => (
                      <StatusPill key={q} tone="neutral" label={q} />
                    ))}
                  </p>
                  {l.notes ? <p className="m-0 text-body whitespace-pre-line">{l.notes}</p> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="self-start"
                    aria-expanded={open === l.id}
                    onClick={() => setOpen(open === l.id ? null : l.id)}
                  >
                    {t('edit', { name: l.name })}
                  </Button>
                  {open === l.id ? (
                    <LeadEditor
                      idPrefix={`lead-${l.id}`}
                      qualifiers={setup.qualifiers}
                      lead={l}
                      online={online}
                      onSave={(edits) => onSave(l.id, edits)}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
