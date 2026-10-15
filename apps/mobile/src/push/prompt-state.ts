/**
 * When the app may ask for notifications (decision P7-8, `legal-copy`).
 *
 * The app explains first (the pre-prompt) and only then shows the phone's own sheet. It asks at two
 * moments and never at launch:
 *
 * - **the first purchase** completing, and
 * - **a ticket being opened** for the first time.
 *
 * "Not now" is remembered with the number of purchases made so far, and the app asks again only
 * after a later purchase. The phone's answer (yes or no) is the phone's: once it has decided, the
 * app never asks again, and a refusal never blocks anything. Changing the mind is in
 * Account → Notifications, which links to the phone's settings.
 */
import type { KeyValueStore } from '@yayatoh/mobile-core';
import type { PushPermission } from './port';

export type PushMoment = 'purchase_completed' | 'ticket_opened';

export interface PromptState {
  /** Purchases that completed on this install (the counter "a later purchase" is measured on). */
  readonly purchases: number;
  /** The first-ticket-open moment has been used. */
  readonly ticketMomentUsed: boolean;
  /** How many times the pre-prompt was shown. */
  readonly shown: number;
  /** The purchase count when the person chose "Not now"; null if they have not. */
  readonly deferredAtPurchases: number | null;
}

export const PROMPT_STATE_KEY = 'yayatoh.push.prompt.v1';

export const INITIAL_PROMPT_STATE: PromptState = {
  purchases: 0,
  ticketMomentUsed: false,
  shown: 0,
  deferredAtPurchases: null,
};

const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

export async function loadPromptState(storage: KeyValueStore): Promise<PromptState> {
  try {
    const raw = await storage.get(PROMPT_STATE_KEY);
    if (!raw) return INITIAL_PROMPT_STATE;
    const v = JSON.parse(raw) as Partial<Record<keyof PromptState, unknown>>;
    return {
      purchases: count(v.purchases),
      ticketMomentUsed: v.ticketMomentUsed === true,
      shown: count(v.shown),
      deferredAtPurchases: v.deferredAtPurchases === null ? null : count(v.deferredAtPurchases),
    };
  } catch {
    // Unreadable means "start over": at worst the person is asked once more at the next moment.
    return INITIAL_PROMPT_STATE;
  }
}

export async function savePromptState(storage: KeyValueStore, state: PromptState): Promise<void> {
  try {
    await storage.set(PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Not remembering is harmless: the state is only there to avoid asking too often.
  }
}

/**
 * Whether the pre-prompt is shown at `moment`, and the state to keep. `state` already counts a
 * purchase that just completed (see `afterPurchase`).
 */
export function decidePrompt(
  moment: PushMoment,
  permission: PushPermission,
  state: PromptState,
): { readonly ask: boolean; readonly state: PromptState } {
  // The phone decided (yes or no): nothing for the app to ask.
  if (permission !== 'undetermined') return { ask: false, state };

  if (moment === 'ticket_opened') {
    // Only the very first time, and only if the person has not been asked at all yet.
    const first = !state.ticketMomentUsed && state.shown === 0;
    const next = { ...state, ticketMomentUsed: true, ...(first ? { shown: state.shown + 1 } : {}) };
    return { ask: first, state: next };
  }

  const firstTime = state.shown === 0;
  const laterPurchase = state.deferredAtPurchases !== null && state.purchases > state.deferredAtPurchases;
  return {
    ask: firstTime || laterPurchase,
    state: firstTime || laterPurchase ? { ...state, shown: state.shown + 1 } : state,
  };
}

export const afterPurchase = (state: PromptState): PromptState => ({
  ...state,
  purchases: state.purchases + 1,
});

/** "Not now": ask again only after a purchase later than this one. */
export const afterNotNow = (state: PromptState): PromptState => ({
  ...state,
  deferredAtPurchases: state.purchases,
});
