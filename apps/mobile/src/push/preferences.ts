/**
 * The kinds of push a person can switch off (P7-8): reminders (24 h and 2 h before start) and event
 * changes (changed or cancelled). Order confirmations and ticket transfers are service messages and
 * stay on. Marketing pushes are off unless the person opts in through the consent ledger.
 *
 * The server does not store this yet: `/v1` has no preferences route for the app, and the push
 * payload carries no kind, so a switch on the phone could not be honoured. Until a server increment
 * adds the route, `serverPreferencesUnavailable` keeps the screen honest: it shows what is sent and
 * points to the phone's own settings, instead of switches that would do nothing. The screen is
 * complete and tested against a port that supports saving, so enabling it is an adapter swap.
 */
export interface KindPreferences {
  readonly reminders: boolean;
  readonly eventChanges: boolean;
}

export interface PreferencesPort {
  /** True when the server stores and honours the choice. */
  readonly supported: boolean;
  load(): Promise<KindPreferences>;
  /** Rejects when the choice could not be saved. */
  save(next: KindPreferences): Promise<void>;
}

export const DEFAULT_KIND_PREFERENCES: KindPreferences = { reminders: true, eventChanges: true };

export const serverPreferencesUnavailable: PreferencesPort = {
  supported: false,
  load: async () => DEFAULT_KIND_PREFERENCES,
  save: async () => {
    throw new Error('Notification preferences are not stored on the server yet');
  },
};
