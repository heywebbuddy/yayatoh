import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localKeyVault } from '../src/key-vault.ts';

describe('local key vault', () => {
  const v = localKeyVault(randomBytes(32).toString('hex'));
  it('round-trips and binds ciphertext to the org', async () => {
    const secret = new Uint8Array([1, 2, 3, 4]);
    const c = await v.encrypt('org-a', secret);
    expect(await v.decrypt('org-a', c)).toEqual(secret);
    await expect(v.decrypt('org-b', c)).rejects.toThrow();
    const parts = c.split('.');
    const body = parts[3] as string;
    parts[3] = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    await expect(v.decrypt('org-a', parts.join('.'))).rejects.toThrow();
  });
});
