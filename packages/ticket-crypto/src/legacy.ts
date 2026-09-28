/**
 * Migrated legacy QR payloads (roadmap §7.5, M2.2b). Eventmie printed the booking's
 * `order_number` either bare or inside a JSON object; both scan. Case matters (the payload is
 * stored as issued), so it is never upper-cased the way short codes are.
 */
export function legacyQrPayload(raw: string): string | null {
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const v = (JSON.parse(text) as Record<string, unknown>).order_number;
      return typeof v === 'string' || typeof v === 'number' ? legacyQrPayload(String(v)) : null;
    } catch {
      return null;
    }
  }
  return /^[0-9A-Za-z_-]{6,64}$/.test(text) ? text : null;
}

/**
 * The offline manifest's hash of a legacy payload (M1.9e): SHA-256 of `legacy:salt:payload`, hex.
 * Per-event salted like the email lookup hash, but case-sensitive and domain-separated, so a
 * device never holds a payload it could print, and a hash can't be mistaken for an email's.
 */
export async function legacyPayloadHash(salt: string, payload: string): Promise<string> {
  const data = new TextEncoder().encode(`legacy:${salt}:${payload}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
