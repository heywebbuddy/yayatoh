import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import {
  afterNotNow,
  afterPurchase,
  decidePrompt,
  INITIAL_PROMPT_STATE,
  loadPromptState,
  PROMPT_STATE_KEY,
  type PromptState,
  savePromptState,
} from '../src/push/prompt-state';

/** Play a sequence of moments the way the provider does; returns where the pre-prompt was shown. */
function play(
  moments: readonly ('purchase_completed' | 'ticket_opened' | 'not_now')[],
  permission: 'undetermined' | 'granted' | 'denied' = 'undetermined',
) {
  let state: PromptState = INITIAL_PROMPT_STATE;
  const asked: number[] = [];
  moments.forEach((m, i) => {
    if (m === 'not_now') {
      state = afterNotNow(state);
      return;
    }
    if (m === 'purchase_completed') state = afterPurchase(state);
    const d = decidePrompt(m, permission, state);
    state = d.state;
    if (d.ask) asked.push(i);
  });
  return { asked, state };
}

describe('when the app asks for notifications (P7-8)', () => {
  it('never asks at launch: there is no moment for it', () => {
    // No moment, no decision: a fresh install has asked nothing.
    expect(INITIAL_PROMPT_STATE.shown).toBe(0);
  });

  it('asks after the first purchase', () => {
    expect(play(['purchase_completed']).asked).toEqual([0]);
  });

  it('asks the first time a ticket is opened, and not the next times', () => {
    expect(play(['ticket_opened', 'ticket_opened', 'ticket_opened']).asked).toEqual([0]);
  });

  it('asks once for the first purchase and the first ticket together', () => {
    expect(play(['purchase_completed', 'ticket_opened']).asked).toEqual([0]);
    expect(play(['ticket_opened', 'purchase_completed']).asked).toEqual([0]);
  });

  it('after Not now at a ticket, asks again only after a later purchase', () => {
    const { asked } = play([
      'ticket_opened',
      'not_now',
      'ticket_opened',
      'ticket_opened',
      'purchase_completed',
    ]);
    expect(asked).toEqual([0, 4]);
  });

  it('after Not now at a purchase, a ticket opening does not ask, the next purchase does', () => {
    const { asked } = play([
      'purchase_completed',
      'not_now',
      'ticket_opened',
      'purchase_completed',
      'not_now',
      'ticket_opened',
      'purchase_completed',
    ]);
    expect(asked).toEqual([0, 3, 6]);
  });

  it('does not ask again for a purchase if the person never answered "Not now" (the sheet decided)', () => {
    // Shown at purchase 1, the person tapped "Turn on": the phone now says granted or denied.
    expect(play(['purchase_completed', 'purchase_completed'], 'granted').asked).toEqual([]);
    expect(play(['purchase_completed', 'purchase_completed'], 'denied').asked).toEqual([]);
  });

  it('a refusal by the phone is final for the app: it never asks over the phone’s decision', () => {
    const { asked } = play(['ticket_opened', 'purchase_completed', 'purchase_completed'], 'denied');
    expect(asked).toEqual([]);
  });

  it('counts purchases from the number at the time of "Not now"', () => {
    let state: PromptState = { ...afterPurchase(afterPurchase(INITIAL_PROMPT_STATE)), shown: 1 }; // asked once, after two purchases
    state = afterNotNow(state);
    expect(state.deferredAtPurchases).toBe(2);
    expect(decidePrompt('purchase_completed', 'undetermined', state).ask).toBe(false);
    expect(decidePrompt('purchase_completed', 'undetermined', afterPurchase(state)).ask).toBe(true);
  });
});

describe('prompt state storage', () => {
  it('round-trips through secure storage', async () => {
    const storage = memoryKeyValueStore();
    const state: PromptState = { purchases: 3, ticketMomentUsed: true, shown: 2, deferredAtPurchases: 1 };
    await savePromptState(storage, state);
    expect(await loadPromptState(storage)).toEqual(state);
  });

  it('starts over from nothing, junk, or wrong types', async () => {
    expect(await loadPromptState(memoryKeyValueStore())).toEqual(INITIAL_PROMPT_STATE);
    expect(await loadPromptState(memoryKeyValueStore({ [PROMPT_STATE_KEY]: '{nope' }))).toEqual(
      INITIAL_PROMPT_STATE,
    );
    const odd = memoryKeyValueStore({
      [PROMPT_STATE_KEY]: JSON.stringify({
        purchases: -4,
        shown: 'x',
        ticketMomentUsed: 'yes',
        deferredAtPurchases: 2.5,
      }),
    });
    expect(await loadPromptState(odd)).toEqual({ ...INITIAL_PROMPT_STATE, deferredAtPurchases: 0 });
  });

  it('a storage failure never throws', async () => {
    const broken = {
      get: async () => {
        throw new Error('keychain');
      },
      set: async () => {
        throw new Error('keychain');
      },
      delete: async () => {},
    };
    expect(await loadPromptState(broken)).toEqual(INITIAL_PROMPT_STATE);
    await expect(savePromptState(broken, INITIAL_PROMPT_STATE)).resolves.toBeUndefined();
  });
});
