/**
 * What the door shows for each verdict (M7.4b): a colour, a headline, a sound and a haptic, so a
 * verdict never rests on colour alone. The verdict itself comes from `checkin-engine`; this only
 * decides how it looks, sounds and feels.
 *
 * Tones: `admit` (let them in), `warn` (stop and look: a repeat, or a pass the phone cannot confirm)
 * and `stop` (do not admit). Each tone has its own sound and haptic, and a duplicate has its own
 * sound so a busy door can hear the difference from across the room.
 */
import type { VerdictId } from './types';

export type Tone = 'admit' | 'warn' | 'stop';
export type SoundId = 'admit' | 'warn' | 'duplicate' | 'stop';
export type HapticId = 'success' | 'warning' | 'duplicate' | 'error';

export interface VerdictView {
  readonly id: VerdictId;
  readonly tone: Tone;
  readonly sound: SoundId;
  readonly haptic: HapticId;
  /** Message keys under `scan.verdict.<key>.title` and (when present) `scan.verdict.<key>.hint`. */
  readonly key: string;
  readonly hint: boolean;
}

interface Def {
  readonly tone: Tone;
  readonly sound?: SoundId;
  readonly hint?: boolean;
}

const DEFS: Record<VerdictId, Def> = {
  admit: { tone: 'admit' },
  granted: { tone: 'admit' },
  entered: { tone: 'admit' },
  scanned_out: { tone: 'admit' },
  admitted: { tone: 'admit' },
  provisional: { tone: 'warn', sound: 'warn', hint: true },
  duplicate: { tone: 'warn', sound: 'duplicate', hint: true },
  duplicate_offline: { tone: 'warn', sound: 'duplicate', hint: true },
  superseded: { tone: 'stop', hint: true },
  void: { tone: 'stop', hint: true },
  invalid: { tone: 'stop', hint: true },
  wrong_event: { tone: 'stop', hint: true },
  outside_window: { tone: 'stop', hint: true },
  wrong_date: { tone: 'stop', hint: true },
  not_today: { tone: 'stop', hint: true },
  no_access: { tone: 'stop', hint: true },
  wrong_checkpoint: { tone: 'stop', hint: true },
  balance_due: { tone: 'stop', hint: true },
  not_in_room: { tone: 'stop', hint: true },
  not_enrolled: { tone: 'stop', hint: true },
  admission_level: { tone: 'stop', hint: true },
  capacity: { tone: 'stop', hint: true },
};

const BY_TONE: Record<Tone, { sound: SoundId; haptic: HapticId }> = {
  admit: { sound: 'admit', haptic: 'success' },
  warn: { sound: 'warn', haptic: 'warning' },
  stop: { sound: 'stop', haptic: 'error' },
};

export function viewFor(id: VerdictId): VerdictView {
  const def = DEFS[id] ?? { tone: 'stop' as const, hint: true };
  const base = BY_TONE[def.tone];
  const sound = def.sound ?? base.sound;
  return {
    id,
    tone: def.tone,
    sound,
    haptic: sound === 'duplicate' ? 'duplicate' : base.haptic,
    key: DEFS[id] ? id : 'invalid',
    hint: def.hint ?? false,
  };
}

/** Every verdict the screen can show, for tests that must cover them all. */
export const ALL_VERDICTS = Object.keys(DEFS) as VerdictId[];
