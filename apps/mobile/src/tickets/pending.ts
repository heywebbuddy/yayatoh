/**
 * A link that needs the person to sign in first (M7.3b): a claim link or a ticket link. The app
 * keeps where it was going in secure storage while the sign-in flow runs, and the Tickets tab picks
 * it up once there is a session, so the person lands on the ticket they came for. The token is a
 * credential, so it lives in the keychain and goes as soon as it is used.
 */
import type { KeyValueStore } from '@yayatoh/mobile-core';

export const PENDING_KEY = 'yayatoh.pending-ticket-link.v1';

export type PendingLink = { readonly kind: 'claim' | 'link'; readonly token: string };

const TOKEN = /^[A-Za-z0-9_.~-]{8,512}$/;

export async function rememberPending(store: KeyValueStore, link: PendingLink): Promise<void> {
  await store.set(PENDING_KEY, JSON.stringify(link));
}

export async function takePending(store: KeyValueStore): Promise<PendingLink | null> {
  const raw = await store.get(PENDING_KEY);
  if (!raw) return null;
  await store.delete(PENDING_KEY);
  try {
    const v = JSON.parse(raw) as Partial<PendingLink>;
    return (v.kind === 'claim' || v.kind === 'link') && typeof v.token === 'string' && TOKEN.test(v.token)
      ? { kind: v.kind, token: v.token }
      : null;
  } catch {
    return null;
  }
}

export const clearPending = (store: KeyValueStore): Promise<void> => store.delete(PENDING_KEY);
