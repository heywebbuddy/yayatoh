'use client';

import type { ModStateDto, PublicLiveStateDto, StageDto } from '@yayatoh/engagement/client';
import { useCallback, useState } from 'react';
import { type StreamState, useRealtime } from '@/lib/use-realtime.ts';

/**
 * A session's live state on a screen (M5.7a), kept current from its realtime channel. Every
 * message carries the full allowlisted shape of what changed, so applying it is an upsert or a
 * removal by id; a `snapshot` (first connect, or a resume the server can't replay) replaces it
 * all, so a screen that dropped its stream is whole again either way.
 */
type Poll = { id: string; createdAt: string };
type Question = { id: string };
type State<P extends Poll, Q extends Question> = { stage: StageDto; polls: P[]; questions: Q[] };

function upsert<T extends { id: string }>(list: readonly T[], item: T, order?: (a: T, b: T) => number): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  const next = i === -1 ? [...list, item] : list.map((x) => (x.id === item.id ? item : x));
  return order ? next.sort(order) : next;
}

const byCreated = (a: Poll, b: Poll) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

export function applyLiveMessage<P extends Poll, Q extends Question>(
  s: State<P, Q>,
  event: string,
  data: unknown,
): State<P, Q> {
  if (!data || typeof data !== 'object') return s;
  switch (event) {
    case 'snapshot':
      return data as State<P, Q>;
    case 'stage':
      return { ...s, stage: data as StageDto };
    case 'poll':
      return { ...s, polls: upsert(s.polls, data as P, byCreated) };
    case 'poll-removed':
      return { ...s, polls: s.polls.filter((p) => p.id !== (data as { id: string }).id) };
    case 'question':
      return { ...s, questions: upsert(s.questions, data as Q) };
    case 'question-removed':
      return { ...s, questions: s.questions.filter((q) => q.id !== (data as { id: string }).id) };
    default:
      return s;
  }
}

const EVENTS = ['snapshot', 'stage', 'poll', 'poll-removed', 'question', 'question-removed'] as const;

export function useLiveState<S extends PublicLiveStateDto | ModStateDto>(
  url: string | null,
  initial: S,
): { state: S; stream: StreamState; apply: (event: string, data: unknown) => void } {
  const [state, setState] = useState<S>(initial);
  const apply = useCallback(
    (event: string, data: unknown) =>
      setState((s) => applyLiveMessage(s as never, event, data) as unknown as S),
    [],
  );
  const handlers = Object.fromEntries(EVENTS.map((e) => [e, (d: unknown) => apply(e, d)]));
  const stream = useRealtime(url, EVENTS, handlers);
  return { state, stream, apply };
}
