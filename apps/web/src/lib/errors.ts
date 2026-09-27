import { ERROR_STATUS, type ErrorCode } from '@yayatoh/kernel';

/**
 * problem+json / DomainError code → i18n key under `errors.*`. Unknown codes fall back to
 * `errors.internal`, so a new server code never shows raw text to users.
 */
export function errorMessageKey(code: string | undefined | null): `errors.${ErrorCode}` {
  return code && code in ERROR_STATUS ? `errors.${code as ErrorCode}` : 'errors.internal';
}
