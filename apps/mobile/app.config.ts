import { buildExpoConfig } from '@yayatoh/mobile-core/app-config';
import { dark, light } from '@yayatoh/ui/tokens';

// Names, scheme, bundle IDs, link domains and the API URL per APP_ENV live in mobile-core, so
// this app and Yayatoh Staff cannot drift apart. Colours come from the design tokens.
export default () =>
  buildExpoConfig({
    app: 'mobile',
    splash: { light: light.canvas, dark: dark.canvas },
    adaptiveBackground: light.primary,
    assets: {
      icon: './assets/icon.png',
      adaptiveForeground: './assets/adaptive-icon.png',
      splash: './assets/splash-icon.png',
    },
  });
