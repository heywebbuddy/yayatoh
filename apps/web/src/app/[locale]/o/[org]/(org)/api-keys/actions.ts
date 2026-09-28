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

/** Revoke a key (a step-up command: answers `step_up_required` when the session is not fresh). */
export async function revokeApiKeyAction(
  org: string,
  apiKeyId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  try {
    await executeCommand(revokeApiKeyCommand, { apiKeyId }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/api-keys`);
}
