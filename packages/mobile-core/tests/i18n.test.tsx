import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useTranslations } from 'use-intl';
import { coreCatalogs, messagesFor } from '../src/i18n/catalogs';
import { type DirectionPorts, resetDirectionGuard, syncDirection } from '../src/i18n/direction';
import { DEFAULT_LOCALE, isRtlLocale, LOCALES, LOCALE_NAMES, pickFromPreferences, pickLocale } from '../src/i18n/locales';
import { LOCALE_STORAGE_KEY, LocaleProvider, type LocaleApi, useLocaleSettings } from '../src/i18n/provider';
import { requiredPluralForms, validateCatalogs } from '../src/i18n/validate';
import { memoryKeyValueStore } from '../src/ports';

describe('shared catalogs', () => {
  it('has the 13 web locales, with Arabic the only right-to-left one', () => {
    expect([...LOCALES].sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru', 'zh-CN', 'zh-TW'].sort(),
    );
    expect(Object.keys(coreCatalogs).sort()).toEqual([...LOCALES].sort());
    expect(LOCALES.filter(isRtlLocale)).toEqual(['ar']);
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...LOCALES].sort());
  });

  it('gives every locale exactly the English keys, with valid ICU and the plural forms its language needs', () => {
    expect(validateCatalogs(coreCatalogs)).toEqual([]);
  });

  it('needs the plural forms common.md lists', () => {
    expect(requiredPluralForms('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(requiredPluralForms('ru')).toEqual(['one', 'few', 'many', 'other']);
    expect(requiredPluralForms('ja')).toEqual(['other']);
    expect(requiredPluralForms('zh-CN')).toEqual(['other']);
    expect(requiredPluralForms('de')).toEqual(['one', 'other']);
  });

  it('really does contain plurals in Arabic and Russian (the check is not vacuous)', () => {
    expect(String(coreCatalogs.ar.offline && (coreCatalogs.ar.offline as Record<string, string>).queued)).toContain('zero {');
    expect(String((coreCatalogs.ru.offline as Record<string, string>).queued)).toContain('many {');
  });
});

describe('validateCatalogs', () => {
  const en = { a: 'Hello', n: '{count, plural, one {# item} other {# items}}' };

  it('reports a missing key, an extra key and an empty value', () => {
    const problems = validateCatalogs({ en, de: { a: ' ', extra: 'x' } });
    expect(problems).toEqual(
      expect.arrayContaining(['de: missing n', 'de: extra extra', 'de: a is empty']),
    );
  });

  it('reports broken ICU syntax', () => {
    const problems = validateCatalogs({ en, de: { a: 'Hallo {', n: '{count, plural, one {# Ding} other {# Dinge}}' } });
    expect(problems.some((p) => p.startsWith('de: a is not valid ICU'))).toBe(true);
  });

  it('reports a placeholder that differs from English', () => {
    const problems = validateCatalogs({
      en: { a: 'Hi {name}' },
      de: { a: 'Hallo {vorname}' },
    });
    expect(problems).toEqual(['de: a uses {vorname} but English uses {name}']);
  });

  it('reports a plural missing a form its language needs, and one it never uses', () => {
    const problems = validateCatalogs({
      en,
      ar: { a: 'x', n: '{count, plural, one {#} other {#}}' },
      ja: { a: 'x', n: '{count, plural, one {#} other {#}}' },
      ru: { a: 'x', n: '{count, plural, one {#} few {#} other {#}}' },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'ar: n {count} lacks the "zero" plural form',
        'ar: n {count} lacks the "two" plural form',
        'ru: n {count} lacks the "many" plural form',
        'ja: n {count} has a "one" form ja never uses',
      ]),
    );
  });

  it('accepts exact-number forms', () => {
    expect(
      validateCatalogs({ en: { n: '{c, plural, =0 {none} one {#} other {#}}' }, de: { n: '{c, plural, =0 {keine} one {#} other {#}}' } }),
    ).toEqual([]);
  });
});

describe('pickLocale', () => {
  it.each([
    ['en-US', 'en'],
    ['pt-BR', 'pt'],
    ['ar_EG', 'ar'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['sv-SE', DEFAULT_LOCALE],
    ['', DEFAULT_LOCALE],
    [undefined, DEFAULT_LOCALE],
    [null, DEFAULT_LOCALE],
  ])('%s -> %s', (tag, expected) => {
    expect(pickLocale(tag)).toBe(expected);
  });

  it('takes the first of the phone’s languages that we have', () => {
    expect(pickFromPreferences(['sv-SE', 'de-DE', 'en-US'])).toBe('de');
    expect(pickFromPreferences(['sv-SE', 'zh-Hant-HK'])).toBe('zh-TW');
    expect(pickFromPreferences(['sv-SE', 'fi-FI'])).toBe('en');
    expect(pickFromPreferences([])).toBe('en');
  });
});

describe('messagesFor', () => {
  it('adds the shared strings under core to the app’s own', () => {
    const merged = messagesFor({ en: { home: { title: 'T' } }, de: { home: { title: 'D' } } }, 'de');
    expect(merged.home).toEqual({ title: 'D' });
    expect(merged.core).toBe(coreCatalogs.de);
  });
  it('falls back to English app strings when a locale has none', () => {
    expect(messagesFor({ en: { home: { title: 'T' } } }, 'fr').home).toEqual({ title: 'T' });
  });
});

function fakeDirection(isRTL: boolean) {
  const ports = {
    isRTL,
    allowRTL: jest.fn(),
    forceRTL: jest.fn((v: boolean) => void v),
    reload: jest.fn(async () => {}),
  };
  return ports satisfies DirectionPorts;
}

describe('syncDirection', () => {
  beforeEach(resetDirectionGuard);

  it('does nothing when the native direction already matches', () => {
    const ports = fakeDirection(false);
    expect(syncDirection('en', ports)).toBe(false);
    expect(ports.forceRTL).not.toHaveBeenCalled();
    expect(ports.reload).not.toHaveBeenCalled();
    expect(ports.allowRTL).toHaveBeenCalledWith(true);
  });

  it('forces right-to-left for Arabic and reloads, once', () => {
    const ports = fakeDirection(false);
    expect(syncDirection('ar', ports)).toBe(true);
    expect(ports.forceRTL).toHaveBeenCalledWith(true);
    expect(ports.reload).toHaveBeenCalledTimes(1);
    // Rendered again before the reload took effect: it must not ask again.
    expect(syncDirection('ar', ports)).toBe(false);
    expect(ports.reload).toHaveBeenCalledTimes(1);
  });

  it('forces left-to-right when leaving Arabic', () => {
    const ports = fakeDirection(true);
    expect(syncDirection('de', ports)).toBe(true);
    expect(ports.forceRTL).toHaveBeenCalledWith(false);
    expect(ports.reload).toHaveBeenCalledTimes(1);
  });
});

function Probe({ onApi }: { onApi?: (a: LocaleApi) => void }) {
  const t = useTranslations('core');
  const api = useLocaleSettings();
  onApi?.(api);
  return (
    <Text testID="probe" accessibilityLabel={t('common.close')}>
      {t('common.retry')}|{api.locale}|{String(api.isRtl)}
    </Text>
  );
}

describe('LocaleProvider', () => {
  beforeEach(resetDirectionGuard);

  it('renders English by default and uses the shared strings', () => {
    render(
      <LocaleProvider catalogs={{ en: {} }} deviceLanguageTags={['en-US']} direction={fakeDirection(false)}>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('probe').props.children.join('')).toBe('Try again|en|false');
    expect(screen.getByLabelText('Close')).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'ltr' });
  });

  it('follows the phone’s language', () => {
    render(
      <LocaleProvider catalogs={{}} deviceLanguageTags={['ja-JP']} direction={fakeDirection(false)}>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('probe').props.children.join('')).toBe('もう一度試す|ja|false');
  });

  it('Arabic renders right to left: the layout direction, the forced native direction, the labels', () => {
    const ports = fakeDirection(false);
    render(
      <LocaleProvider catalogs={{}} deviceLanguageTags={['ar-EG']} direction={ports}>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('probe').props.children.join('')).toBe('حاول مرة أخرى|ar|true');
    expect(screen.getByLabelText('إغلاق')).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(ports.forceRTL).toHaveBeenCalledWith(true);
    expect(ports.reload).toHaveBeenCalledTimes(1);
  });

  it('formats plurals per language', () => {
    function Count({ n }: { n: number }) {
      return <Text testID="c">{useTranslations('core')('offline.queued', { count: n })}</Text>;
    }
    const view = (tags: string[], n: number) => {
      render(
        <LocaleProvider catalogs={{}} deviceLanguageTags={tags} direction={fakeDirection(tags[0] === 'ar')}>
          <Count n={n} />
        </LocaleProvider>,
      );
      const text = screen.getByTestId('c').props.children as string;
      screen.unmount();
      return text;
    };
    expect(view(['en'], 1)).toBe('1 change will be sent when you\'re back online.');
    expect(view(['en'], 3)).toBe('3 changes will be sent when you\'re back online.');
    expect(view(['ru'], 2)).toContain('2 изменения');
    expect(view(['ru'], 5)).toContain('5 изменений');
    expect(view(['ar'], 2)).toContain('تغييرين');
    expect(view(['ar'], 0)).toContain('لا توجد');
    expect(view(['ja'], 4)).toContain('4件');
  });

  it('an in-app choice beats the phone, and is remembered', async () => {
    const store = memoryKeyValueStore();
    let api!: LocaleApi;
    render(
      <LocaleProvider catalogs={{}} store={store} deviceLanguageTags={['en-US']} direction={fakeDirection(false)}>
        <Probe onApi={(a) => (api = a)} />
      </LocaleProvider>,
    );
    act(() => api.setChoice('de'));
    expect(screen.getByTestId('probe').props.children.join('')).toBe('Erneut versuchen|de|false');
    expect(store.data.get(LOCALE_STORAGE_KEY)).toBe('de');

    screen.unmount();
    render(
      <LocaleProvider catalogs={{}} store={store} deviceLanguageTags={['en-US']} direction={fakeDirection(false)}>
        <Probe />
      </LocaleProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children.join('')).toBe('Erneut versuchen|de|false');
  });

  it('ignores a stored value that is not a locale', async () => {
    const store = memoryKeyValueStore({ [LOCALE_STORAGE_KEY]: 'klingon' });
    render(
      <LocaleProvider catalogs={{}} store={store} deviceLanguageTags={['fr-FR']} direction={fakeDirection(false)}>
        <Probe />
      </LocaleProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children.join('')).toBe('Réessayer|fr|false');
  });

  it('switching to Arabic at runtime flips the direction and asks for the reload', () => {
    const ports = fakeDirection(false);
    let api!: LocaleApi;
    render(
      <LocaleProvider catalogs={{}} deviceLanguageTags={['en-US']} direction={ports}>
        <Probe onApi={(a) => (api = a)} />
      </LocaleProvider>,
    );
    expect(ports.reload).not.toHaveBeenCalled();
    act(() => api.setChoice('ar'));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(ports.forceRTL).toHaveBeenCalledWith(true);
    expect(ports.reload).toHaveBeenCalledTimes(1);
  });

  it('a missing message shows its key, never a crash', () => {
    function Missing() {
      return <Text testID="m">{useTranslations('core')('nope.nothing')}</Text>;
    }
    render(
      <LocaleProvider catalogs={{}} deviceLanguageTags={['en']} direction={fakeDirection(false)}>
        <Missing />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('m').props.children).toBe('core.nope.nothing');
  });
});
