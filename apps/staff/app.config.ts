import { buildExpoConfig } from '@yayatoh/mobile-core/app-config';
import { dark, light } from '@yayatoh/ui/tokens';

// Only this app asks for the camera (door scanning, M7.4b); the permission text is in
// locales/*.json so iOS shows it in the phone's language.
const base = () =>
  buildExpoConfig({
    app: 'staff',
    splash: { light: light.canvas, dark: dark.canvas },
    adaptiveBackground: light.brandStrong,
    assets: {
      icon: './assets/icon.png',
      adaptiveForeground: './assets/adaptive-icon.png',
      splash: './assets/splash-icon.png',
    },
    locales: {
      ar: './locales/ar.json',
      de: './locales/de.json',
      en: './locales/en.json',
      es: './locales/es.json',
      fr: './locales/fr.json',
      hi: './locales/hi.json',
      it: './locales/it.json',
      ja: './locales/ja.json',
      nl: './locales/nl.json',
      pt: './locales/pt.json',
      ru: './locales/ru.json',
      'zh-Hans': './locales/zh-Hans.json',
      'zh-Hant': './locales/zh-Hant.json',
    },
  });

/**
 * The guest list on the phone is encrypted (M7.4b): `expo-sqlite` is built with SQLCipher, and the
 * key lives only in the keychain. Camera and vibration permissions come with their libraries.
 */
export default () => {
  const config = base();
  return { ...config, plugins: [...(config.plugins ?? []), ['expo-sqlite', { useSQLCipher: true }]] };
};
