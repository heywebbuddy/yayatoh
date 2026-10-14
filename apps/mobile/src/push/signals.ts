/**
 * The two P7-8 moments, as a tiny event channel: any part of the app can say "a purchase just
 * completed" or "a ticket was opened" without importing the push provider, and a moment that
 * happens before the provider has mounted (a cold start through a checkout return link) is kept
 * until it does.
 */
import type { PushMoment } from './prompt-state';

type Listener = (moment: PushMoment) => void;

const listeners = new Set<Listener>();
let queued: PushMoment[] = [];

/** Tell the push provider that `moment` happened. Safe to call from anywhere, at any time. */
export function reportPushMoment(moment: PushMoment): void {
  if (listeners.size === 0) {
    queued.push(moment);
    return;
  }
  for (const l of listeners) l(moment);
}

/** The provider's side: gets the moments that were waiting, then every new one. */
export function onPushMoment(listener: Listener): () => void {
  listeners.add(listener);
  const waiting = queued;
  queued = [];
  for (const m of waiting) listener(m);
  return () => listeners.delete(listener);
}

/** For tests: forget everything. */
export function resetPushSignals(): void {
  listeners.clear();
  queued = [];
}
