'use client';

import type { SolverProblemDto } from '@yayatoh/seating';
import { compile, evaluate, type SolverProblem, type SolverRuleSpec } from '@yayatoh/seating/client';
import { Alert, Badge, Button, fieldClass, Input, ProgressBar } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useMemo, useState, useTransition } from 'react';
import type { SolverState } from '@/app/[locale]/o/[org]/e/[event]/seating/solver/actions.ts';
import { Link, useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useSolver } from './use-solver.ts';

export interface ProposalNames {
  readonly guests: ReadonlyMap<string, { name: string; party: string }>;
  readonly places: readonly { itemId: string; label: string }[];
}

type Seats = Record<string, string | null>;
type Feedback = { tone: 'success' | 'danger' | 'warning'; text: string } | null;

async function keyOf(nonce: string, tables: { itemId: string; guestIds: string[] }[]) {
  const text = JSON.stringify([nonce, tables.map((t) => [t.itemId, [...t.guestIds].sort()])]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The proposal (M6.12a): run the solver (a Web Worker; progress and a Stop button), read the
 * text summary, move any proposed guest with the table chooser beside their name (the list is
 * the whole editor: no dragging needed), then accept one table or all. Guests seated by hand
 * are never part of a proposal. Hard-rule breaks and over-full tables are shown and stop the
 * accept until the host changes the proposal.
 */
export function SolverProposal({
  problem,
  names,
  describe,
  canWrite,
  editorHref,
  accept,
}: {
  problem: SolverProblemDto;
  names: ProposalNames;
  describe: (r: SolverRuleSpec) => string;
  canWrite: boolean;
  editorHref: string;
  accept: (input: { tables: { itemId: string; guestIds: string[] }[]; key: string }) => Promise<SolverState>;
}) {
  const t = useTranslations('seating.solver');
  const tRoot = useTranslations();
  const id = useId();
  const router = useRouter();
  const { run, start, cancel } = useSolver();
  const [seed, setSeed] = useState('1');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [nonce, setNonce] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const solverProblem = problem as SolverProblem;
  const compiled = useMemo(() => compile(solverProblem), [solverProblem]);
  const fixedCount = Object.keys(problem.fixed).length;
  const queue = problem.guests.filter((g) => !(g.id in problem.fixed)).length;

  // A finished run becomes the editable proposal.
  useEffect(() => {
    if (run.state === 'done') {
      setSeats({ ...run.proposal.seats });
      setNonce(`${run.seed}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    }
  }, [run]);

  // Guests seated since (by hand, or accepted) leave the proposal.
  const live = useMemo(() => {
    if (!seats) return null;
    const out: Seats = {};
    for (const [g, t] of Object.entries(seats)) if (!(g in problem.fixed) && names.guests.has(g)) out[g] = t;
    return out;
  }, [seats, problem.fixed, names.guests]);

  const evaluation = useMemo(
    () => (live ? evaluate(compiled, { ...live, ...problem.fixed }) : null),
    [compiled, live, problem.fixed],
  );

  const place = new Map(problem.places.map((p) => [p.itemId, p]));
  const fixedAt = new Map<string, number>();
  for (const item of Object.values(problem.fixed)) fixedAt.set(item, (fixedAt.get(item) ?? 0) + 1);
  const proposedAt = new Map<string, string[]>();
  for (const [g, item] of Object.entries(live ?? {}))
    if (item) proposedAt.set(item, [...(proposedAt.get(item) ?? []), g]);
  const room = (itemId: string) => (place.get(itemId)?.capacity ?? 0) - (fixedAt.get(itemId) ?? 0);
  const tables = names.places.filter((p) => proposedAt.has(p.itemId));
  const inQueue = Object.entries(live ?? {})
    .filter(([, item]) => item === null)
    .map(([g]) => g);
  const rule = (ruleId: string | null) => problem.rules.find((r) => r.id === ruleId);
  const brokenAt = (itemId: string) =>
    (evaluation?.hard ?? [])
      .filter((v) => v.itemIds.includes(itemId))
      .map((v) => {
        const r = rule(v.ruleId);
        return r ? describe(r) : t('tables.over');
      });
  const overAt = (itemId: string) => (proposedAt.get(itemId)?.length ?? 0) > room(itemId);
  const blocked = (itemId: string) => overAt(itemId) || brokenAt(itemId).length > 0;
  const anyBlocked = tables.some((p) => blocked(p.itemId));

  const runIt = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(seed);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      setSeedError(t('run.seedError'));
      return;
    }
    setSeedError(null);
    setFeedback(null);
    setSeats(null);
    start(solverProblem, n);
  };

  const again = () => {
    const n = (Number(seed) || 1) + 1;
    setSeed(String(n));
    setSeats(null);
    setFeedback(null);
    start(solverProblem, n);
  };

  const send = (itemIds: string[]) =>
    startTransition(async () => {
      const chosen = itemIds.map((itemId) => ({ itemId, guestIds: proposedAt.get(itemId) ?? [] }));
      const key = await keyOf(nonce, chosen);
      const r = await accept({ tables: chosen, key });
      if (r.ok) {
        const label = names.places.find((p) => p.itemId === itemIds[0])?.label ?? '';
        setFeedback({
          tone: 'success',
          text:
            itemIds.length === 1
              ? t('tables.acceptedTable', { label, count: r.seated ?? 0 })
              : t('tables.acceptedAll', { count: r.seated ?? 0 }),
        });
        setSeats((s) => {
          if (!s) return s;
          const next = { ...s };
          for (const c of chosen) for (const g of c.guestIds) delete next[g];
          return next;
        });
        router.refresh();
      } else {
        const known: Record<string, string> = {
          already_seated: t('acceptErrors.already_seated'),
          declined: t('acceptErrors.declined'),
          hard_rule: t('acceptErrors.hard_rule'),
          cant_fit: t('acceptErrors.cant_fit', { fits: r.fits ?? 0 }),
        };
        setFeedback({
          tone: 'danger',
          text: (r.reason && known[r.reason]) || tRoot(errorMessageKey(r.code)),
        });
      }
    });

  const move = (guestId: string, to: string) => setSeats((s) => (s ? { ...s, [guestId]: to || null } : s));

  const seatedCount = Object.values(live ?? {}).filter(Boolean).length;
  const running = run.state === 'running';

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h2 id={`${id}-h`} className="m-0 text-h3 font-bold text-ink">
        {t('run.heading')}
      </h2>
      <p className="m-0 text-body text-ink-2">{t('run.queue', { count: queue, fixed: fixedCount })}</p>
      {queue === 0 ? (
        <Alert tone="info" title={t('run.nothing')}>
          <Link href={editorHref} className="font-semibold text-primary-ink underline">
            {t('tables.toEditor')}
          </Link>
        </Alert>
      ) : (
        <form onSubmit={runIt} noValidate className="flex flex-wrap items-end gap-2">
          <Input
            id={`${id}-seed`}
            label={t('run.seed')}
            hint={t('run.seedHint')}
            type="number"
            inputMode="numeric"
            min={1}
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            error={seedError ?? undefined}
            className="w-28"
          />
          <Button type="submit" disabled={running}>
            {t('run.start')}
          </Button>
          {running ? (
            <Button type="button" variant="secondary" onClick={cancel}>
              {t('run.cancel')}
            </Button>
          ) : null}
          {run.state === 'done' && !running ? (
            <Button type="button" variant="secondary" onClick={again}>
              {t('run.again')}
            </Button>
          ) : null}
        </form>
      )}
      <div aria-live="polite" className="flex flex-col gap-2">
        {running ? (
          <>
            <p className="m-0 text-body text-ink">
              {t('run.running', { percent: Math.round(run.progress * 100) })}
            </p>
            <ProgressBar value={Math.round(run.progress * 100)} label={t('run.progress')} />
          </>
        ) : null}
        {run.state === 'cancelled' ? <Alert tone="info" title={t('run.cancelled')} /> : null}
        {run.state === 'failed' ? <Alert tone="danger" title={t('run.failed')} /> : null}
        {feedback ? <Alert tone={feedback.tone} title={feedback.text} /> : null}
      </div>

      {live && evaluation && run.state === 'done' ? (
        <>
          <section
            aria-labelledby={`${id}-sum`}
            className="flex flex-col gap-1 rounded-md border border-line p-3"
          >
            <h3 id={`${id}-sum`} className="m-0 text-body font-bold text-ink">
              {t('summary.heading')}
            </h3>
            <p className="m-0 text-body" data-testid="solver-time" data-ms={Math.round(run.ms)}>
              {t('summary.done', { seconds: (run.ms / 1000).toFixed(1), seed: run.seed })}
            </p>
            <p className="m-0 text-body">
              {t('summary.seated', { count: seatedCount, tables: tables.length, queue: inQueue.length })}
            </p>
            <p className="m-0 text-body font-semibold">
              {evaluation.hard.length
                ? t('summary.hardBroken', { count: evaluation.hard.length })
                : t('summary.hardOk')}
            </p>
            <p className="m-0 text-body">{t('summary.soft', { penalty: evaluation.softPenalty })}</p>
            {problem.rules.length ? (
              <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-body text-ink-2">
                {problem.rules.map((r) => {
                  const s = evaluation.perRule.find((p) => p.ruleId === r.id);
                  return (
                    <li key={r.id}>
                      {t('summary.ruleLine', { rule: describe(r), count: s?.breaches ?? 0 })}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {run.proposal.issues.map((issue) => (
              <Alert
                key={`${issue.code}:${issue.ruleId}`}
                tone="warning"
                title={t(`summary.issues.${issue.code}`, { size: issue.size ?? 0, room: issue.room ?? 0 })}
              />
            ))}
          </section>

          {canWrite && tables.length ? (
            <div>
              <Button
                type="button"
                onClick={() => send(tables.map((p) => p.itemId))}
                disabled={pending || anyBlocked}
              >
                {t('tables.acceptAll')}
              </Button>
              {anyBlocked ? <p className="m-0 mt-1 text-caption text-ink-2">{t('tables.fixFirst')}</p> : null}
            </div>
          ) : null}

          <h3 className="m-0 text-body font-bold text-ink">{t('tables.heading')}</h3>
          {tables.length === 0 ? <p className="m-0 text-body text-ink-2">{t('tables.none')}</p> : null}
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {tables.map((p) => {
              const guests = proposedAt.get(p.itemId) ?? [];
              const free = room(p.itemId) - guests.length;
              const broken = brokenAt(p.itemId);
              return (
                <li key={p.itemId}>
                  <section
                    aria-label={t('tables.region', { label: p.label })}
                    className="flex flex-col gap-2 rounded-md border border-line p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="m-0 text-body font-bold text-ink">
                        {t('tables.region', { label: p.label })}
                      </h4>
                      <Badge tone={free < 0 ? 'danger' : 'neutral'}>
                        {t('tables.fill', {
                          proposed: guests.length,
                          seated: fixedAt.get(p.itemId) ?? 0,
                          free: Math.max(0, free),
                          capacity: place.get(p.itemId)?.capacity ?? 0,
                        })}
                      </Badge>
                    </div>
                    {free < 0 ? (
                      <Alert tone="warning" title={t('tables.overFull', { count: -free })} />
                    ) : null}
                    {broken.length ? (
                      <Alert tone="warning" title={t('tables.broken', { rules: broken.join('; ') })} />
                    ) : null}
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {guests.map((g) => (
                        <GuestRow
                          key={g}
                          guestId={g}
                          name={names.guests.get(g)}
                          value={p.itemId}
                          places={names.places}
                          free={(itemId) => room(itemId) - (proposedAt.get(itemId)?.length ?? 0)}
                          onMove={move}
                          canWrite={canWrite}
                        />
                      ))}
                    </ul>
                    {canWrite ? (
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={pending || blocked(p.itemId)}
                          onClick={() => send([p.itemId])}
                        >
                          {t('tables.accept', { label: p.label })}
                        </Button>
                      </div>
                    ) : null}
                  </section>
                </li>
              );
            })}
          </ul>
          {inQueue.length ? (
            <section aria-label={t('tables.queueHeading')} className="flex flex-col gap-2">
              <h3 className="m-0 text-body font-bold text-ink">{t('tables.queueHeading')}</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {inQueue.map((g) => (
                  <GuestRow
                    key={g}
                    guestId={g}
                    name={names.guests.get(g)}
                    value=""
                    places={names.places}
                    free={(itemId) => room(itemId) - (proposedAt.get(itemId)?.length ?? 0)}
                    onMove={move}
                    canWrite={canWrite}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** A proposed guest and the table chooser that moves them (the keyboard path; no drag). */
function GuestRow({
  guestId,
  name,
  value,
  places,
  free,
  onMove,
  canWrite,
}: {
  guestId: string;
  name: { name: string; party: string } | undefined;
  value: string;
  places: readonly { itemId: string; label: string }[];
  free: (itemId: string) => number;
  onMove: (guestId: string, to: string) => void;
  canWrite: boolean;
}) {
  const t = useTranslations('seating.solver.tables');
  const label = name ? t('guest', { name: name.name, party: name.party }) : '?';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-body text-ink">{label}</span>
      {canWrite ? (
        <select
          aria-label={t('moveLabel', { name: name?.name ?? '?' })}
          value={value}
          onChange={(e) => onMove(guestId, e.target.value)}
          className={fieldClass('sm', 'w-auto pe-9')}
        >
          <option value="">{t('queueOption')}</option>
          {places.map((p) => (
            <option key={p.itemId} value={p.itemId}>
              {t('optionFree', { label: p.label, free: Math.max(0, free(p.itemId)) })}
            </option>
          ))}
        </select>
      ) : null}
    </li>
  );
}
