'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { createApiKeyCommand, revokeApiKeyCommand, rotateApiKeyCommand } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type ApiKeyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'created'; readonly name: string; readonly key: string; readonly sandbox: boolean }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly fields: readonly ('name' | 'scopes')[];
      /** `test_key_scope`: a test key was given a scope it cannot hold. */
      readonly reason?: string;
    };

/** Create an org API key. The key comes back once, here, and is never shown again. */
export async function createApiKeyAction(
  org: string,
  _prev: ApiKeyState,
  form: FormData,
): Promise<ApiKeyState> {
  const data = await loadConsole(org);
  const name = String(form.get('name') ?? '').trim();
  const scopes = form.getAll('scope').map(String);
  const mode = form.get('mode') === 'test' ? 'test' : 'live';
  // M6.3a: the lifetime (days), or no expiry.
  const expiry = String(form.get('expiresInDays') ?? 'never');
  const expiresInDays = expiry === 'never' ? null : Number(expiry);
  try {
    const r = await executeCommand(
      createApiKeyCommand,
      { name, scopes, mode, expiresInDays },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/api-keys`);
    return { kind: 'created', name: r.name, key: r.key, sandbox: r.sandbox };
  } catch (err) {
    if (!isDomainError(err)) return { kind: 'error', code: 'internal', fields: [] };
    const issues = (err.details?.issues as { path: string }[] | undefined) ?? [];
    const fields = [...new Set(issues.map((i) => i.path.split('.')[0]))].filter(
      (f): f is 'name' | 'scopes' => f === 'name' || f === 'scopes',
    );
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
    return { kind: 'error', code: err.code, fields, ...(reason ? { reason } : {}) };
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

export type RotateKeyState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'rotated';
      readonly name: string;
      readonly key: string;
      /** When the old key stops (ISO), or null when it stopped at once. */
      readonly previousUntil: string | null;
    }
  | { readonly kind: 'error'; readonly code: string };

/** Rotate a key (M6.3a, step-up): the new secret comes back once, here. */
export async function rotateApiKeyAction(
  org: string,
  apiKeyId: string,
  _prev: RotateKeyState,
  form: FormData,
): Promise<RotateKeyState> {
  const data = await loadConsole(org);
  const overlapHours = Number(form.get('overlapHours') ?? 24);
  try {
    const r = await executeCommand(rotateApiKeyCommand, { apiKeyId, overlapHours }, data.ctx, ports);
    revalidatePath(`/o/${org}/api-keys`);
    return {
      kind: 'rotated',
      name: r.name,
      key: r.key,
      previousUntil: overlapHours > 0 ? r.previousExpiresAt.toISOString() : null,
    };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}
