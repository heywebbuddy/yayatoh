import { messagesFor } from '@yayatoh/mobile-core';
import { catalogs } from '../../src/i18n';

/** The strings both apps share, under `core`, as far as the screens' tests read them. */
interface CoreMessages {
  signIn: {
    failed: Record<
      | 'invalid_credentials'
      | 'invalid_code'
      | 'too_many_attempts'
      | 'invalid_challenge'
      | 'invalid_id_token'
      | 'provider_email_missing'
      | 'provider_email_unverified'
      | 'provider_linked_elsewhere'
      | 'unknown',
      string
    >;
    unavailable: string;
    unsupported: string;
    rateLimited: string;
  };
  stepUp: Record<'invalid_code' | 'invalid_password', string>;
}
type Messages = typeof catalogs.en & { core: CoreMessages };

/** English and Arabic, with the shared strings under `core`, as the screens see them. */
export const en = messagesFor(catalogs, 'en') as unknown as Messages;
export const ar = messagesFor(catalogs, 'ar') as unknown as typeof catalogs.ar & { core: CoreMessages };
