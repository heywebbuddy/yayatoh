import { messagesFor } from '@yayatoh/mobile-core';
import { catalogs } from '../../src/i18n';

/** English, with the strings both apps share under `core`, as the screens see them. */
export const en = messagesFor(catalogs, 'en') as unknown as typeof catalogs.en & {
  core: typeof import('../../../../packages/mobile-core/messages/en.json');
};
export const ar = messagesFor(catalogs, 'ar') as unknown as typeof catalogs.ar & { core: typeof en.core };
