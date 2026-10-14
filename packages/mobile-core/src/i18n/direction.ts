/**
 * Right-to-left through `I18nManager` (M7.1c). React Native fixes a layout direction when the app
 * starts, so changing language between a left-to-right and a right-to-left one needs a reload;
 * `syncDirection` asks for it once, and the next launch already has the right direction, so it
 * cannot loop.
 */
import * as Updates from 'expo-updates';
import { DevSettings, I18nManager } from 'react-native';
import { type AppLocale, isRtlLocale } from './locales';

export interface DirectionPorts {
  readonly isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
  reload(): Promise<void>;
}

/** Reloads the JavaScript bundle: the update module in a build, the dev menu's reload otherwise. */
export async function reloadApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload();
  }
}

export const reactNativeDirection = (): DirectionPorts => ({
  get isRTL() {
    return I18nManager.getConstants().isRTL;
  },
  allowRTL: (allow) => I18nManager.allowRTL(allow),
  forceRTL: (force) => I18nManager.forceRTL(force),
  reload: reloadApp,
});

let reloadAskedFor: boolean | null = null;

/**
 * Makes the native direction match `locale`. Returns true when a reload was requested (the caller
 * should not render the app in the wrong direction meanwhile).
 */
export function syncDirection(locale: AppLocale, ports: DirectionPorts = reactNativeDirection()): boolean {
  const wantRtl = isRtlLocale(locale);
  ports.allowRTL(true);
  if (ports.isRTL === wantRtl) {
    reloadAskedFor = null;
    return false;
  }
  ports.forceRTL(wantRtl);
  // One reload per direction per run: if forcing did not take (it cannot on some hosts), stop here.
  if (reloadAskedFor === wantRtl) return false;
  reloadAskedFor = wantRtl;
  void ports.reload().catch(() => {});
  return true;
}

/** For tests: forget that a reload was requested. */
export const resetDirectionGuard = () => {
  reloadAskedFor = null;
};
