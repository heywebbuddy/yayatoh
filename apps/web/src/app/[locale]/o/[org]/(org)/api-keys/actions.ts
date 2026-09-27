'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { createApiKeyCommand, revokeApiKeyCommand } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type ApiKeyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'created'; readonly name: string; readonly key: string }
  | { readonly kind: 'error'; readonly code: string; readonly fields: readonly ('name' | 'scopes')[] };

/** Create an org API key. The key comes back once, here, and is never shown again. */
export async function createApiKeyAction(
  org: string,
  _prev: ApiKeyState,
  form: FormData,
): Promise<ApiKeyState> {
  const data = await loadConsole(org);
  const name = String(form.get('name') ?? '').trim();
  const scopes = form.getAll('scope').map(String);
  try {
    const r = await executeCommand(createApiKeyCommand, { name, scopes }, data.ctx, ports);
    revalidatePath(`/o/${org}/api-keys`);
    return { kind: 'created', name: r.name, key: r.key };
  } catch (err) {
    if (!isDomainError(err)) return { kind: 'error', code: 'internal', fields: [] };
    const issues = (err.details?.issues as { path: string }[] | undefined) ?? [];
    const fields = [...new Set(issues.map((i) => i.path.split('.')[0]))].filter(
      (f): f is 'name' | 'scopes' => f === 'name' || f === 'scopes',
    );
    return { kind: 'error', code: err.code, fields };
  }
}

export async function revokeApiKeyAction(org: string, apiKeyId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(revokeApiKeyCommand, { apiKeyId }, data.ctx, ports);
  revalidatePath(`/o/${org}/api-keys`);
}
