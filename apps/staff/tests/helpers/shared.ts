import { messagesFor } from '@yayatoh/mobile-core';
import { catalogs } from '../../src/i18n';

/** The strings the two apps share (mobile-core's `core` namespace), as the screens see them. */
export interface SharedMessages {
  signIn: {
    failed: { invalid_credentials: string; invalid_code: string; invalid_challenge: string };
    unavailable: string;
    rateLimited: string;
  };
}

export const shared = (locale: 'en' | 'ar'): SharedMessages =>
  (messagesFor(catalogs, locale) as unknown as { core: SharedMessages }).core;
