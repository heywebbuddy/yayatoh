import { dark, light, radius, space, TOUCH_TARGET_PX, type } from '@yayatoh/ui/tokens';
import { useColorScheme } from 'react-native';

/**
 * Placeholder theme for the M7.1b shell: the design tokens, light or dark by the phone's setting.
 * M7.1c replaces it with the shared theme (tenant colours with a contrast fallback).
 */
export function useColors() {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Token radii are CSS strings (`24px`); React Native wants numbers. */
export const px = (value: string): number => Number.parseFloat(value);

export { radius, space, TOUCH_TARGET_PX, type };
