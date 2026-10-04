'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { DEFAULT_UI_STRINGS, type UiStrings } from './ui-strings.ts';

interface UiLocale {
  readonly locale: string;
  readonly strings: UiStrings;
}

const Ctx = createContext<UiLocale>({ locale: 'en', strings: DEFAULT_UI_STRINGS });

export function UiLocaleProvider({
  locale,
  strings,
  children,
}: {
  locale: string;
  strings?: Partial<UiStrings>;
  children: ReactNode;
}) {
  return (
    <Ctx.Provider value={{ locale, strings: { ...DEFAULT_UI_STRINGS, ...strings } }}>{children}</Ctx.Provider>
  );
}

export const useUiLocale = (): UiLocale => useContext(Ctx);
