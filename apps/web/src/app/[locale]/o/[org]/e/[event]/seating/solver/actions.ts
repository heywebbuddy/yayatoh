'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  acceptSeatingProposalCommand,
  addSolverRuleCommand,
  removeSolverRuleCommand,
  updateSolverRuleCommand,
} from '@yayatoh/seating';
import type { SolverRuleSpec } from '@yayatoh/seating/client';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What the rule builder and the proposal get back from a change (M6.12a). */
export interface SolverState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** `cant_fit`: how many were to be seated at the table, and how many fit. */
  readonly asked?: number;
  readonly fits?: number;
  /** `hard_rule`: which rules the accept would break, and at which tables. */
  readonly breaches?: readonly { kind: string; ruleId: string | null; itemIds: string[] }[];
  readonly seated?: number;
}

const fail = (err: unknown): SolverState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as { reason?: unknown; asked?: unknown; fits?: unknown; breaches?: unknown };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    asked: typeof d.asked === 'number' ? d.asked : undefined,
    fits: typeof d.fits === 'number' ? d.fits : undefined,
    breaches: Array.isArray(d.breaches) ? (d.breaches as SolverState['breaches']) : undefined,
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const subOf = (v: string | null) => (v && UUID.test(v) ? v : null);

export async function addSolverRuleAction(
  org: string,
  event: string,
  input: { spec: SolverRuleSpec; strength: 'hard' | 'soft'; weight: number },
): Promise<SolverState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(addSolverRuleCommand, { eventId: ev.id, ...input }, data.ctx, ports);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function updateSolverRuleAction(
  org: string,
  event: string,
  input: { ruleId: string; strength: 'hard' | 'soft'; weight: number },
): Promise<SolverState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(updateSolverRuleCommand, { eventId: ev.id, ...input }, data.ctx, ports);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function removeSolverRuleAction(
  org: string,
  event: string,
  ruleId: string,
): Promise<SolverState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(removeSolverRuleCommand, { eventId: ev.id, ruleId }, data.ctx, ports);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

const KEY = /^[A-Za-z0-9:_-]{8,128}$/;

/**
 * Accept proposed tables (one or all). The editor sends a key derived from the proposal and the
 * tables, so pressing twice (or a retry) gives the same answer once (Idempotency-Key).
 */
export async function acceptProposalAction(
  org: string,
  event: string,
  subEventId: string | null,
  input: { tables: { itemId: string; guestIds: string[] }[]; key: string },
): Promise<SolverState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  if (!KEY.test(input.key)) return { ok: false, code: 'validation_failed' };
  try {
    const r = await executeCommand(
      acceptSeatingProposalCommand,
      { eventId: ev.id, subEventId: subOf(subEventId), tables: input.tables },
      { ...data.ctx, idempotencyKey: `seat-proposal:${input.key}` },
      ports,
    );
    return { ok: true, code: null, seated: r.seated };
  } catch (err) {
    return fail(err);
  }
}
