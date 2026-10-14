/**
 * Sound and haptics for a verdict (M7.4b). A verdict never rests on colour alone: each tone has its
 * own sound and its own vibration, and a repeat has a pattern of its own, so a busy door can tell
 * them apart without looking. The native modules are loaded on first use and every failure is
 * swallowed: a phone that cannot vibrate or play a sound still shows the verdict.
 */
import type { HapticId, SoundId, VerdictView } from './verdicts';

export interface Feedback {
  play(view: VerdictView): void;
}

export interface FeedbackDeps {
  /** Plays one of the four sounds from the start. */
  sound(id: SoundId): void | Promise<void>;
  /** Fires one of the four vibration patterns. */
  haptic(id: HapticId): void | Promise<void>;
}

export function createFeedback(deps: FeedbackDeps): Feedback {
  const safe = (fn: () => void | Promise<void>) => {
    try {
      void Promise.resolve(fn()).catch(() => {});
    } catch {
      // Feedback is a courtesy; the verdict on screen is what counts.
    }
  };
  return {
    play(view) {
      safe(() => deps.sound(view.sound));
      safe(() => deps.haptic(view.haptic));
    },
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The phone's own sound and vibration (`expo-audio`, `expo-haptics`). */
export function nativeFeedbackDeps(): FeedbackDeps {
  type Player = { seekTo(seconds: number): Promise<void>; play(): void };
  let players: Record<SoundId, Player> | null = null;

  const load = () => {
    if (players) return players;
    const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    // A door phone's ringer switch is often off; the verdict sound should still play.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    players = {
      admit: createAudioPlayer(require('../../assets/sounds/admit.wav')),
      warn: createAudioPlayer(require('../../assets/sounds/warn.wav')),
      duplicate: createAudioPlayer(require('../../assets/sounds/duplicate.wav')),
      stop: createAudioPlayer(require('../../assets/sounds/stop.wav')),
    };
    return players;
  };

  return {
    async sound(id) {
      const player = load()[id];
      await player.seekTo(0);
      player.play();
    },
    async haptic(id) {
      const H = require('expo-haptics') as typeof import('expo-haptics');
      if (id === 'success') await H.notificationAsync(H.NotificationFeedbackType.Success);
      else if (id === 'warning') await H.notificationAsync(H.NotificationFeedbackType.Warning);
      else if (id === 'error') await H.notificationAsync(H.NotificationFeedbackType.Error);
      else {
        await H.impactAsync(H.ImpactFeedbackStyle.Heavy);
        await wait(120);
        await H.impactAsync(H.ImpactFeedbackStyle.Heavy);
      }
    },
  };
}

export const nativeFeedback: Feedback = createFeedback(nativeFeedbackDeps());
