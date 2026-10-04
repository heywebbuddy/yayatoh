'use server';

import { refreshAgencySnapshotsCommand } from '@yayatoh/agency';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { ports } from '@/server/ports.ts';
import { loadAgency } from './load.ts';

export type RefreshState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly clients: number }
  | { readonly kind: 'error'; readonly code: string };

/** Rebuild the agency's client snapshots now (each client computed under its own tenant). */
export async function refreshAgencyAction(org: string, _prev: RefreshState): Promise<RefreshState> {
  const { data } = await loadAgency(org);
  try {
    const r = await executeCommand(refreshAgencySnapshotsCommand, {}, data.ctx, ports);
    revalidatePath(`/o/${org}/agency`, 'layout');
    return { kind: 'done', clients: r.clients };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}
