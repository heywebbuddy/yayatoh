import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import { createVault, VAULT_KEY_NAME } from '../../src/tools/vault';
import { fakeRandom, testVault } from './fixtures';

describe('the tools vault', () => {
  it('stores JSON sealed under a key held in secure storage', async () => {
    const t = testVault();
    await t.vault.write('guests', { name: 'Grace Hopper' });
    expect(t.storage.data.has(VAULT_KEY_NAME)).toBe(true);
    expect(await t.vault.read('guests')).toEqual({ name: 'Grace Hopper' });
    const file = [...t.files.files.values()][0];
    expect(new TextDecoder().decode(file)).not.toContain('Grace');
  });

  it('reads null for a file it never wrote', async () => {
    expect(await testVault().vault.read('guests')).toBeNull();
  });

  it('cannot read a file without its key, and removes it', async () => {
    const t = testVault();
    await t.vault.write('lead-outbox', [{ code: 'x' }]);
    await t.storage.delete(VAULT_KEY_NAME);
    const again = createVault({ files: t.files, storage: t.storage, random: fakeRandom });
    expect(await again.read('lead-outbox')).toBeNull();
    expect(t.files.files.size).toBe(0);
  });

  it('cannot read a file sealed under another key', async () => {
    const a = testVault();
    await a.vault.write('guests', { a: 1 });
    const b = createVault({
      files: a.files,
      storage: memoryKeyValueStore({ [VAULT_KEY_NAME]: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
      random: fakeRandom,
    });
    expect(await b.read('guests')).toBeNull();
  });

  it('wipe deletes the key and every file, including ones an earlier run wrote', async () => {
    const t = testVault();
    await t.vault.write('guests', 1);
    await t.vault.write('lead-outbox', 2);
    const later = createVault({ files: t.files, storage: t.storage, random: fakeRandom });
    await later.wipe();
    expect(t.storage.data.has(VAULT_KEY_NAME)).toBe(false);
    expect(t.files.files.size).toBe(0);
    await later.wipe();
  });
});
