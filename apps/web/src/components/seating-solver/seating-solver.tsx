'use client';

import type { GuestSeatingDto, SolverProblemDto } from '@yayatoh/seating';
import type { SolverRuleSpec } from '@yayatoh/seating/client';
import { useMemo } from 'react';
import type { SolverState } from '@/app/[locale]/o/[org]/e/[event]/seating/solver/actions.ts';
import { type ProposalNames, SolverProposal } from './solver-proposal.tsx';
import { type RuleNames, SolverRules, useDescribeRule } from './solver-rules.tsx';

/**
 * Seating rules and the solver (M6.12a): the rule builder above, the proposal below. Names come
 * from the guest seating editor's view; the solver's input (`SolverProblemDto`) carries ids only.
 */
export function SeatingSolver({
  view,
  problem,
  canWrite,
  editorHref,
  addRule,
  updateRule,
  removeRule,
  accept,
}: {
  view: GuestSeatingDto;
  problem: SolverProblemDto;
  canWrite: boolean;
  editorHref: string;
  addRule: (input: {
    spec: SolverRuleSpec;
    strength: 'hard' | 'soft';
    weight: number;
  }) => Promise<SolverState>;
  updateRule: (input: { ruleId: string; strength: 'hard' | 'soft'; weight: number }) => Promise<SolverState>;
  removeRule: (ruleId: string) => Promise<SolverState>;
  accept: (input: { tables: { itemId: string; guestIds: string[] }[]; key: string }) => Promise<SolverState>;
}) {
  const ruleNames = useMemo<RuleNames>(() => {
    const tags = new Set<string>();
    const sides = new Set<string>();
    for (const p of view.parties) {
      for (const tag of p.tags) tags.add(tag);
      if (p.side) sides.add(p.side);
    }
    return {
      parties: view.parties.map((p) => ({ id: p.id, name: p.name })),
      tags: [...tags].sort(),
      sides: [...sides].sort(),
    };
  }, [view.parties]);
  const proposalNames = useMemo<ProposalNames>(
    () => ({
      guests: new Map(
        view.parties.flatMap((p) =>
          p.guests.map((g) => [g.id, { name: g.name ?? g.guestOf ?? '?', party: p.name }] as const),
        ),
      ),
      places: view.places.map((p) => ({ itemId: p.itemId, label: p.label })),
    }),
    [view.parties, view.places],
  );
  const describe = useDescribeRule(ruleNames);
  return (
    <div className="flex flex-col gap-6">
      <SolverRules
        rules={problem.rules}
        names={ruleNames}
        canWrite={canWrite}
        add={addRule}
        update={updateRule}
        remove={removeRule}
      />
      <SolverProposal
        problem={problem}
        names={proposalNames}
        describe={describe}
        canWrite={canWrite}
        editorHref={editorHref}
        accept={accept}
      />
    </div>
  );
}
