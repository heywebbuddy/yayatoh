import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { IntlProvider } from 'use-intl';
import type { KeyValueStore } from '../ports';
import { type MessageTree, messagesFor } from './catalogs';
import { type DirectionPorts, reactNativeDirection, syncDirection } from './direction';
import { type AppLocale, DEFAULT_LOCALE, isAppLocale, isRtlLocale, pickFromPreferences } from './locales';

export const LOCALE_STORAGE_KEY = 'yayatoh.pref.locale';
export type LocaleChoice = AppLocale | 'system';

export interface LocaleApi {
  /** The language in use. */
  readonly locale: AppLocale;
  /** What the person picked: a language, or `system` to follow the phone. */
  readonly choice: LocaleChoice;
  setChoice(choice: LocaleChoice): void;
  readonly isRtl: boolean;
}

const LocaleContext = createContext<LocaleApi | null>(null);

export interface LocaleProviderProps {
  /** The app's own catalogs; the shared `core` strings are added to each. */
  readonly catalogs: Partial<Record<AppLocale, MessageTree>>;
  readonly store?: KeyValueStore;
  /** For tests: the phone's preferred languages instead of reading them from the system. */
  readonly deviceLanguageTags?: readonly string[];
  readonly direction?: DirectionPorts;
  readonly children: ReactNode;
}

const readDeviceTags = (): string[] => getLocales().map((l) => l.languageTag);

export function LocaleProvider({
  catalogs,
  store,
  deviceLanguageTags,
  direction,
  children,
}: LocaleProviderProps) {
  const [choice, setChoiceState] = useState<LocaleChoice>('system');
  const [device, setDevice] = useState<readonly string[]>(() => deviceLanguageTags ?? readDeviceTags());
  const ports = useMemo(() => direction ?? reactNativeDirection(), [direction]);

  // Re-read the phone's languages when the app comes back to the front: the person may have changed them.
  useEffect(() => {
    if (deviceLanguageTags) {
      setDevice(deviceLanguageTags);
      return;
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDevice(readDeviceTags());
    });
    return () => sub.remove();
  }, [deviceLanguageTags]);

  useEffect(() => {
    let live = true;
    store
      ?.get(LOCALE_STORAGE_KEY)
      .then((stored) => {
        if (live && stored && (stored === 'system' || isAppLocale(stored))) setChoiceState(stored);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [store]);

  const locale: AppLocale = choice === 'system' ? pickFromPreferences(device) : choice;
  const isRtl = isRtlLocale(locale);

  useEffect(() => {
    syncDirection(locale, ports);
  }, [locale, ports]);

  const setChoice = useCallback(
    (next: LocaleChoice) => {
      setChoiceState(next);
      store?.set(LOCALE_STORAGE_KEY, next).catch(() => {});
    },
    [store],
  );

  const api = useMemo<LocaleApi>(
    () => ({ locale, choice, setChoice, isRtl }),
    [locale, choice, setChoice, isRtl],
  );
  const messages = useMemo(() => messagesFor(catalogs, locale), [catalogs, locale]);

  return (
    <LocaleContext.Provider value={api}>
      <IntlProvider
        locale={locale}
        messages={messages}
        onError={() => {}}
        getMessageFallback={({ namespace, key }) => [namespace, key].filter(Boolean).join('.')}
      >
        {/* The direction is set on the root as well: the first render is right while a reload that
            fixes the native direction (navigation bars, gestures) is pending. */}
        <View style={{ flex: 1, direction: isRtl ? 'rtl' : 'ltr' }} testID="locale-root">
          {children}
        </View>
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocaleSettings(): LocaleApi {
  const api = useContext(LocaleContext);
  if (!api) throw new Error('useLocaleSettings needs a LocaleProvider (CoreProvider has one)');
  return api;
}

export { DEFAULT_LOCALE };
