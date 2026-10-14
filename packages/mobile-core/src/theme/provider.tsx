import type { ThemeChoice } from '@yayatoh/ui/tokens';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { KeyValueStore } from '../ports';
import { parseThemeChoice, resolveScheme, resolveTheme, type ResolvedTheme, THEME_STORAGE_KEY } from './theme';

export interface ThemeApi extends ResolvedTheme {
  /** What the person chose in the app: `system` (follow the phone), `light` or `dark`. */
  readonly choice: ThemeChoice;
  setChoice(choice: ThemeChoice): void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export interface ThemeProviderProps {
  /** Where the override is kept (secure storage in the apps). Optional: without it, it lasts a launch. */
  readonly store?: KeyValueStore;
  readonly initialChoice?: ThemeChoice;
  /** A tenant brand colour for the whole tree; usually set per screen with `BrandScope` instead. */
  readonly brand?: string | null;
  readonly children: ReactNode;
}

export function ThemeProvider({ store, initialChoice = 'system', brand, children }: ThemeProviderProps) {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>(initialChoice);

  useEffect(() => {
    let live = true;
    store
      ?.get(THEME_STORAGE_KEY)
      .then((stored) => {
        if (live && stored) setChoiceState(parseThemeChoice(stored));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [store]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      setChoiceState(next);
      store?.set(THEME_STORAGE_KEY, next).catch(() => {});
    },
    [store],
  );

  const value = useMemo<ThemeApi>(
    () => ({ ...resolveTheme(resolveScheme(choice, system), brand), choice, setChoice }),
    [choice, system, brand, setChoice],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme needs a ThemeProvider (CoreProvider has one)');
  return theme;
}

/** The colours of the current mode (and brand, when inside a `BrandScope`). */
export const useColors = () => useTheme().colors;

/**
 * Applies a tenant's brand colour to everything inside, e.g. an event screen. A colour that is not
 * readable in the current mode is ignored and the default colours stay.
 */
export function BrandScope({ color, children }: { color: string | null | undefined; children: ReactNode }) {
  const parent = useTheme();
  const value = useMemo<ThemeApi>(
    () => ({ ...parent, ...resolveTheme(parent.scheme, color) }),
    [parent, color],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
