import { LEGAL_HOLD_BASES } from '@yayatoh/platform';
import { z } from 'zod';
import { canonicalJson, type DsarSigner, verifyDsarSignature } from './signing.ts';

/**
 * The erasure receipt (M6.1c): what was erased and what was kept and why, signed with Ed25519.
 * It holds no personal data (the subject appears as a masked hint and a SHA-256), so the org can
 * keep it as proof of the erasure and the person can be sent a copy. The PDF is rendered from it
 * on demand, in the reader's language.
 */
export const RECEIPT_FORMAT = 'yayatoh.dsar-receipt/1';

export const ReceiptTable = z.object({
  table: z.string(),
  action: z.enum(['delete', 'redact', 'hold']),
  rows: z.int().min(0),
});

export const ReceiptHeld = z.object({
  table: z.string(),
  id: z.string(),
  ref: z.string(),
  basis: z.enum(LEGAL_HOLD_BASES),
  until: z.string().nullable(),
});

export const Receipt = z.object({
  format: z.literal(RECEIPT_FORMAT),
  requestId: z.uuid(),
  org: z.object({ id: z.uuid(), name: z.string() }),
  subject: z.object({ hint: z.string(), ref: z.string().regex(/^[0-9a-f]{64}$/) }),
  source: z.enum(['staff', 'self']),
  requestedAt: z.iso.datetime(),
  dueAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime(),
  erased: z.array(ReceiptTable),
  held: z.array(ReceiptHeld),
  /** Stored files (uploads, photos, earlier archives) deleted after the erasure committed. */
  files: z.int().min(0),
  /** Connected services told to erase the person too (M6.4; none until then). */
  connectors: z.array(z.string()),
  /** The address is on the platform-wide erased list: no org mails or re-imports it for marketing. */
  suppressed: z.boolean(),
  key: z.object({ algorithm: z.literal('Ed25519'), id: z.string() }),
});
export type Receipt = z.infer<typeof Receipt>;

/** The bytes that are signed: the receipt as canonical JSON. */
export const receiptBytes = (r: Receipt) => new TextEncoder().encode(canonicalJson(r));

export async function signReceipt(r: Receipt, signer: DsarSigner): Promise<string> {
  return signer.sign(receiptBytes(r));
}

export function verifyReceipt(r: Receipt, signature: string, publicKeyPem: string): boolean {
  return verifyDsarSignature(publicKeyPem, receiptBytes(r), signature);
}
