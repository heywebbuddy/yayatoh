import { useQueryClient } from '@tanstack/react-query';
import { YayatohApiError } from '@yayatoh/sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import type { LeadRating, LeadScanResult, LeadSetup } from '../api';
import { useTools } from '../deps';
import {
  checkEdit,
  createLeadOutbox,
  type FlushFailure,
  type LeadOutbox,
  matchesLead,
  RATINGS,
  type ScanGate,
  scanGate,
  type ShownLead,
  shownLead,
} from '../leads';
import { toolKeys, useLeadList, useLeadSetup } from '../queries';
import { Body, Button, Card, Chip, Empty, ErrorState, Field, Heading, Loading, Notice, Row, Screen } from '../ui';

/** The rep's outbox: scans go in first and out when the connection allows. */
function useLeadOutbox(): LeadOutbox | null {
  const { portal, vault, newId, clock, useOffline } = useTools();
  const offline = useOffline();
  return useMemo(
    () =>
      portal
        ? createLeadOutbox({ vault, api: offline ? null : portal.api, owner: portal.owner, newId, now: clock.now })
        : null,
    [portal, vault, newId, clock, offline],
  );
}

const gateText = (why: Exclude<ScanGate, { open: true }>['why']) => `gate.${why}`;

/** Lead retrieval home: the rep's licence and window, the outbox, and the leads they may see. */
export function LeadsScreen() {
  const t = useTranslations('leads');
  const core = useTranslations('core');
  const { portal, clock, navigate, useOffline } = useTools();
  const offline = useOffline();
  const qc = useQueryClient();
  const setup = useLeadSetup();
  const gate = setup.data ? scanGate(setup.data, clock.now()) : null;
  const list = useLeadList(!!setup.data?.capture.accessOpen);
  const outbox = useLeadOutbox();
  const [pending, setPending] = useState(0);
  const [failure, setFailure] = useState<FlushFailure | null>(null);
  const [sent, setSent] = useState(false);
  const [query, setQuery] = useState('');

  const flush = useCallback(async () => {
    if (!outbox) return;
    const r = await outbox.flush();
    setPending(r.pending);
    setFailure(r.failure);
    setSent(r.failure === null && r.results.length > 0);
    if (r.results.length > 0 && portal) await qc.invalidateQueries({ queryKey: toolKeys.leads(portal.owner) });
  }, [outbox, portal, qc]);

  useEffect(() => {
    if (!outbox) return;
    outbox.pending().then((p) => {
      setPending(p.length);
      if (p.length > 0 && !offline) void flush();
    });
  }, [outbox, offline, flush]);

  if (!portal) return <Screen><Empty title={t('notSignedIn')} /></Screen>;
  if (setup.isPending) return <Screen><Loading label={t('title')} /></Screen>;
  if (!setup.data)
    return (
      <Screen>
        <ErrorState message={t('loadFailed')} retryLabel={core('common.retry')} onRetry={() => setup.refetch()} />
      </Screen>
    );

  const accessEnded =
    !setup.data.capture.accessOpen ||
    (list.isError && list.error instanceof YayatohApiError && list.error.status === 409);
  const leads = (list.data?.leads ?? []).map(shownLead).filter((l) => matchesLead(l, query));

  return (
    <Screen testID="leads-screen">
      <Heading>{t('title')}</Heading>
      <Body muted>{t('setup', { exhibitor: setup.data.exhibitorName, event: setup.data.eventName })}</Body>
      {gate && !gate.open ? (
        <Notice tone="warn" testID="leads-gate">{t(gateText(gate.why))}</Notice>
      ) : null}
      <Button
        label={t('scan')}
        onPress={() => navigate('/tools/leads/scan')}
        disabled={!gate?.open}
        testID="leads-scan"
      />
      {pending > 0 ? (
        <Card testID="leads-pending">
          <Body>{t('pending', { count: pending })}</Body>
          {failure ? <Notice tone="warn">{t(`syncFailed.${failure}`)}</Notice> : null}
          <Row>
            <Button label={t('sendNow')} onPress={flush} disabled={offline} testID="leads-send" />
          </Row>
        </Card>
      ) : sent ? (
        <Notice tone="ok">{t('sent')}</Notice>
      ) : null}
      {accessEnded ? <Notice tone="info">{t('accessEnded')}</Notice> : null}
      {list.isError && !accessEnded ? (
        <ErrorState message={t('loadFailed')} retryLabel={core('common.retry')} onRetry={() => list.refetch()} />
      ) : null}
      {list.data ? (
        <>
          <Body muted testID="leads-scope">{t(`scope.${list.data.scope}`)}</Body>
          <Field
            label={t('searchLabel')}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            testID="leads-search"
          />
          <Heading level={2}>{t('count', { count: leads.length })}</Heading>
          {list.data.leads.length === 0 ? <Empty title={t('empty')} body={t('emptyBody')} /> : null}
          {list.data.leads.length > 0 && leads.length === 0 ? <Empty title={t('noMatches')} /> : null}
          {leads.map((l) => (
            <LeadRow key={l.id} lead={l} onOpen={() => navigate(`/tools/leads/${l.id}`)} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function LeadRow({ lead, onOpen }: { lead: ShownLead; onOpen: () => void }) {
  const t = useTranslations('leads');
  const title = lead.name ?? lead.company ?? lead.jobTitle ?? t('lead.notShared');
  return (
    <Card testID={`lead-${lead.id}`}>
      <Heading level={2}>{title}</Heading>
      {lead.name && (lead.jobTitle || lead.company) ? (
        <Body muted>{[lead.jobTitle, lead.company].filter(Boolean).join(' · ')}</Body>
      ) : null}
      {lead.rating ? <Body>{t(`capture.ratings.${lead.rating}`)}</Body> : null}
      <Button
        label={t('open')}
        a11yLabel={t('openFor', { name: title })}
        onPress={onOpen}
        variant="secondary"
        testID={`open-lead-${lead.id}`}
      />
    </Card>
  );
}

/* --------------------------------------------------------------------- scan ---- */

type Saved =
  | { kind: 'online'; result: LeadScanResult }
  | { kind: 'offline' }
  | { kind: 'failed'; failure: FlushFailure };

/** Scan a badge (or type its code), rate and qualify the lead, and save it: online at once, offline into the queue. */
export function LeadScanScreen() {
  const t = useTranslations('leads');
  const core = useTranslations('core');
  const { portal, Scanner, clock, useOffline, feedback } = useTools();
  const offline = useOffline();
  const setup = useLeadSetup();
  const outbox = useLeadOutbox();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typedProblem, setTypedProblem] = useState(false);
  const [rating, setRating] = useState<LeadRating | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);

  if (!portal) return <Screen><Empty title={t('notSignedIn')} /></Screen>;
  if (setup.isPending) return <Screen><Loading label={t('scanner.hint')} /></Screen>;
  if (!setup.data)
    return (
      <Screen>
        <ErrorState message={t('loadFailed')} retryLabel={core('common.retry')} onRetry={() => setup.refetch()} />
      </Screen>
    );
  const gate = scanGate(setup.data, clock.now());
  if (!gate.open) return <Screen><Notice tone="warn" testID="scan-gate">{t(gateText(gate.why))}</Notice></Screen>;

  function reset() {
    setCode(null);
    setTyped('');
    setRating(null);
    setPicked([]);
    setNotes('');
    setProblem(null);
    setSaved(null);
  }

  async function save() {
    const edit = { qualifiers: picked, notes };
    const p = checkEdit(edit);
    if (p) return setProblem(p);
    if (!outbox || !code) return;
    setProblem(null);
    setBusy(true);
    try {
      const scan = await outbox.add({ code, rating, qualifiers: picked, notes, offline });
      if (offline) {
        setSaved({ kind: 'offline' });
        feedback?.('ok');
        return;
      }
      const r = await outbox.flush();
      const mine = r.results.find((x) => x.scanId === scan.scanId);
      if (mine) {
        setSaved({ kind: 'online', result: mine });
        feedback?.(mine.status === 'refused' ? 'stop' : 'ok');
      } else if (r.failure === 'unreachable') {
        setSaved({ kind: 'offline' });
        feedback?.('ok');
      } else setSaved({ kind: 'failed', failure: r.failure ?? 'rejected' });
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <SavedView saved={saved} onNext={reset} />;

  if (!code)
    return (
      <Screen testID="lead-scan-screen">
        <Heading>{t('scan')}</Heading>
        {Scanner ? (
          <>
            <Body muted>{t('scanner.hint')}</Body>
            <Scanner active onCode={(c) => setCode(c)} />
          </>
        ) : (
          <Notice tone="info" testID="scanner-off">{t('scanner.cameraOff')}</Notice>
        )}
        <Field
          label={t('scanner.manualLabel')}
          hint={t('scanner.manualHint')}
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            setTypedProblem(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          error={typedProblem ? t('scanner.codeMissing') : null}
          testID="lead-code"
        />
        <Button
          label={t('scanner.useCode')}
          onPress={() => (typed.trim() ? setCode(typed.trim()) : setTypedProblem(true))}
          testID="lead-code-use"
        />
      </Screen>
    );

  return (
    <Screen testID="lead-capture">
      <Heading>{t('capture.title')}</Heading>
      <Body muted>{t('capture.rating')}</Body>
      <Row>
        {RATINGS.map((r) => (
          <Chip
            key={r}
            label={t(`capture.ratings.${r}`)}
            selected={rating === r}
            onPress={() => setRating(rating === r ? null : r)}
            testID={`rating-${r}`}
          />
        ))}
      </Row>
      <Body muted>{t('capture.qualifiers')}</Body>
      {setup.data.qualifiers.length === 0 ? (
        <Body muted>{t('capture.noQualifiers')}</Body>
      ) : (
        <Row>
          {setup.data.qualifiers.map((q) => (
            <Chip
              key={q}
              label={q}
              selected={picked.includes(q)}
              onPress={() => setPicked((cur) => (cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q]))}
              testID={`qualifier-${q}`}
            />
          ))}
        </Row>
      )}
      <Field
        label={t('capture.notes')}
        value={notes}
        onChangeText={setNotes}
        multiline
        error={problem ? t(`capture.errors.${problem}`) : null}
        testID="lead-notes"
      />
      <Button
        label={busy ? t('capture.saving') : t('capture.save')}
        onPress={save}
        busy={busy}
        testID="lead-save"
      />
    </Screen>
  );
}

function SavedView({ saved, onNext }: { saved: Saved; onNext: () => void }) {
  const t = useTranslations('leads');
  const lead = saved.kind === 'online' && saved.result.lead ? shownLead(saved.result.lead) : null;
  return (
    <Screen testID="lead-saved">
      {saved.kind === 'offline' ? <Notice tone="info">{t('capture.savedOffline')}</Notice> : null}
      {saved.kind === 'failed' ? <Notice tone="warn">{t(`syncFailed.${saved.failure}`)}</Notice> : null}
      {saved.kind === 'online' && saved.result.status === 'refused' ? (
        <Notice tone="stop">{t(`refused.${saved.result.reason ?? 'invalid'}`)}</Notice>
      ) : null}
      {saved.kind === 'online' && saved.result.status === 'captured' ? (
        <Notice tone="ok">{t('capture.savedOnline')}</Notice>
      ) : null}
      {saved.kind === 'online' && saved.result.status === 'rescanned' ? (
        <Notice tone="ok">{t('capture.rescanned')}</Notice>
      ) : null}
      {lead ? (
        <Card testID="lead-saved-card">
          {lead.name ? <Heading level={2}>{lead.name}</Heading> : null}
          {[lead.jobTitle, lead.company].filter(Boolean).length ? (
            <Body muted>{[lead.jobTitle, lead.company].filter(Boolean).join(' · ')}</Body>
          ) : null}
        </Card>
      ) : null}
      <Button label={t('capture.another')} onPress={onNext} testID="lead-next" />
    </Screen>
  );
}

/* ------------------------------------------------------------------- detail ---- */

/** One lead: only the fields the attendee agreed to share (P5-8), and the rep's own rating, qualifiers and notes. */
export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const t = useTranslations('leads');
  const core = useTranslations('core');
  const format = useFormatter();
  const { portal } = useTools();
  const qc = useQueryClient();
  const setup = useLeadSetup();
  const list = useLeadList(!!setup.data?.capture.accessOpen);
  const raw = list.data?.leads.find((l) => l.id === leadId) ?? null;
  const [edit, setEdit] = useState<{ rating: LeadRating | null; qualifiers: string[]; notes: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<'saved' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);

  if (!portal) return <Screen><Empty title={t('notSignedIn')} /></Screen>;
  if (setup.data && !setup.data.capture.accessOpen)
    return <Screen><Notice tone="info">{t('accessEnded')}</Notice></Screen>;
  if (list.isPending || setup.isPending) return <Screen><Loading label={t('title')} /></Screen>;
  if (list.isError)
    return (
      <Screen>
        <ErrorState message={t('loadFailed')} retryLabel={core('common.retry')} onRetry={() => list.refetch()} />
      </Screen>
    );
  if (!raw) return <Screen><Empty title={t('lead.notFound')} /></Screen>;
  const lead = shownLead(raw);
  const form = edit ?? { rating: lead.rating, qualifiers: [...lead.qualifiers], notes: lead.notes };
  // Qualifiers the exhibitor removed stay visible on the lead, so they can be taken off.
  const choices = [...new Set([...(setup.data?.qualifiers ?? []), ...lead.qualifiers])];

  async function save() {
    const p = checkEdit(form);
    if (p) return setProblem(p);
    setProblem(null);
    setBusy(true);
    setState(null);
    try {
      await (portal as NonNullable<typeof portal>).api.updateLead(leadId, form);
      setState('saved');
      await qc.invalidateQueries({ queryKey: toolKeys.leads((portal as NonNullable<typeof portal>).owner) });
    } catch {
      setState('failed');
    } finally {
      setBusy(false);
    }
  }

  const shown: [string, string | null][] = [
    [t('lead.name'), lead.name],
    [t('lead.jobTitle'), lead.jobTitle],
    [t('lead.company'), lead.company],
    [t('lead.email'), lead.email],
  ];
  return (
    <Screen testID="lead-detail">
      <Notice tone="info">{t('lead.consent')}</Notice>
      <Card>
        {shown.map(([label, value]) => (
          <Body key={label} testID={`field-${label}`}>
            {label}: {value ?? t('lead.notShared')}
          </Body>
        ))}
        {lead.emailWithdrawn ? <Notice tone="warn">{t('lead.emailWithdrawn')}</Notice> : null}
        <Body muted>{t('lead.scans', { count: lead.scans })}</Body>
        <Body muted>
          {t('lead.capturedAt', {
            time: format.dateTime(new Date(lead.capturedAt), { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </Body>
        {lead.scannedBy ? <Body muted>{t('lead.scannedBy', { name: lead.scannedBy })}</Body> : null}
      </Card>
      <Body muted>{t('capture.rating')}</Body>
      <Row>
        {RATINGS.map((r) => (
          <Chip
            key={r}
            label={t(`capture.ratings.${r}`)}
            selected={form.rating === r}
            onPress={() => setEdit({ ...form, rating: form.rating === r ? null : r })}
            testID={`rating-${r}`}
          />
        ))}
      </Row>
      <Body muted>{t('capture.qualifiers')}</Body>
      <Row>
        {choices.map((q) => (
          <Chip
            key={q}
            label={q}
            selected={form.qualifiers.includes(q)}
            onPress={() =>
              setEdit({
                ...form,
                qualifiers: form.qualifiers.includes(q) ? form.qualifiers.filter((x) => x !== q) : [...form.qualifiers, q],
              })
            }
            testID={`qualifier-${q}`}
          />
        ))}
      </Row>
      <Field
        label={t('capture.notes')}
        value={form.notes}
        onChangeText={(v) => setEdit({ ...form, notes: v })}
        multiline
        error={problem ? t(`capture.errors.${problem}`) : null}
        testID="lead-notes"
      />
      {state === 'saved' ? <Notice tone="ok">{t('lead.saved')}</Notice> : null}
      {state === 'failed' ? <Notice tone="stop">{t('lead.saveFailed')}</Notice> : null}
      <Button label={t('lead.save')} onPress={save} busy={busy} testID="lead-save" />
    </Screen>
  );
}
