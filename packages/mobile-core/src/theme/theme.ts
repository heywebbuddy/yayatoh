/**
 * Theme (M7.1c): the design tokens in light and dark, following the system unless the person chose
 * a mode in the app, with a tenant's brand colour applied only where it stays readable.
 *
 * A brand colour arrives from an API response at runtime, so it is untrusted: it must be an opaque
 * hex colour and must reach 4.5:1 against the mode's surface (it is used as text and as a fill).
 * Otherwise the default colours stay: a pale brand in light mode, or a dark one in dark mode, never
 * reaches a screen.
 */
import {
  type ColorRole,
  constant,
  dark,
  DEFAULT_THEME,
  isThemeChoice,
  light,
  radius,
  space,
  type ThemeChoice,
  TOUCH_TARGET_PX,
  type as typeScale,
} from '@yayatoh/ui/tokens';
import { contrastRatio, isHexColor, MIN_TEXT_CONTRAST, mix } from './contrast';

export type Palette = Record<ColorRole, string>;
export type SchemeName = 'light' | 'dark';

export const palettes: Record<SchemeName, Palette> = { light, dark };

export interface ResolvedTheme {
  readonly scheme: SchemeName;
  readonly colors: Palette;
  /** Whether a tenant brand colour is in use (false when none was given or it was too faint). */
  readonly brandApplied: boolean;
}

/** `system` follows the phone; an unknown stored value falls back to the default. */
export function resolveScheme(choice: ThemeChoice, system: string | null | undefined): SchemeName {
  if (choice === 'light' || choice === 'dark') return choice;
  return system === 'dark' ? 'dark' : system === 'light' ? 'light' : DEFAULT_THEME === 'dark' ? 'dark' : 'light';
}

/** The palette for `scheme`, with `brand` applied to the primary roles when it is readable. */
export function resolveTheme(scheme: SchemeName, brand?: string | null): ResolvedTheme {
  const base = palettes[scheme];
  const colour = typeof brand === 'string' ? brand.trim() : '';
  // Contrast is measured on the opaque surface: dark mode's `surface` is translucent.
  if (!isHexColor(colour) || !(contrastRatio(colour, base.surfaceSolid) >= MIN_TEXT_CONTRAST)) {
    return { scheme, colors: base, brandApplied: false };
  }
  // The label on a brand button: the token's own `onPrimary`, or black when that is too faint.
  const onBrand = [base.onPrimary, constant.black].find((c) => contrastRatio(c, colour) >= MIN_TEXT_CONTRAST);
  if (!onBrand) return { scheme, colors: base, brandApplied: false };
  const toward = scheme === 'light' ? constant.black : constant.white;
  return {
    scheme,
    brandApplied: true,
    colors: {
      ...base,
      primary: colour,
      primaryHover: mix(colour, toward, 0.1),
      primaryPressed: mix(colour, toward, 0.18),
      onPrimary: onBrand,
      primaryInk: colour,
    },
  };
}

export const THEME_STORAGE_KEY = 'yayatoh.pref.theme';

export const parseThemeChoice = (stored: string | null): ThemeChoice =>
  isThemeChoice(stored) ? stored : 'system';

/** Token radii are CSS strings (`24px`); React Native wants numbers. */
export const px = (value: string): number => Number.parseFloat(value);

export { radius, space, TOUCH_TARGET_PX, typeScale as type };
