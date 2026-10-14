import { render } from '@testing-library/react-native';
import { type AppLocale, LocaleProvider, ThemeProvider } from '@yayatoh/mobile-core';
import type { ReactElement } from 'react';
import { catalogs } from '../../src/i18n';
import type { Feedback } from '../../src/scan/feedback';
import type { FakeServer } from './harness';

/** The scan screens inside the same providers the app has, in any of the 13 locales. */
export function renderIn(ui: ReactElement, locale: AppLocale = 'en') {
  return render(
    <ThemeProvider>
      <LocaleProvider
        catalogs={catalogs}
        deviceLanguageTags={[locale]}
        direction={{ isRTL: locale === 'ar', allowRTL: () => {}, forceRTL: () => {}, reload: async () => {} }}
      >
        {ui}
      </LocaleProvider>
    </ThemeProvider>,
  );
}

export function spyFeedback(): Feedback & { played: string[] } {
  const played: string[] = [];
  return { played, play: (view) => void played.push(`${view.sound}+${view.haptic}`) };
}

export type { FakeServer };
