import { createHash, randomBytes } from 'node:crypto';
import { stableStringify } from '@yayatoh/kernel';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The hash a record link keeps of a Yayatoh record's mapped fields (key order does not matter). */
export const fieldsHash = (fields: Readonly<Record<string, unknown>>) => sha256(stableStringify(fields));

/** A single-use OAuth state (only its hash is stored). */
export const newState = () => randomBytes(24).toString('base64url');

/** The `Idempotency-Key` for sending one record's content: the same record and content, the same key. */
export const pushKey = (connectionId: string, objectType: string, localId: string, hash: string) =>
  `yy-${sha256(`${connectionId}|${objectType}|${localId}|${hash}`).slice(0, 48)}`;
