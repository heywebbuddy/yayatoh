import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import {
  DB_KEY_NAME,
  DB_NAME,
  destroyScanDb,
  openEncryptedScanDb,
  ScanDbKeyError,
  scanDbKey,
  type SqliteHandle,
  type SqliteModule,
  wrapHandle,
} from '../../src/scan/db';
import { fakeSqlite, nodeHandle, testRandom } from './harness';

const KEY = 'ab'.repeat(32);

describe('the database key', () => {
  it('is 256 random bits made once and kept only in the keychain', async () => {
    const storage = memoryKeyValueStore();
    const key = await scanDbKey(storage, testRandom);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.data.get(DB_KEY_NAME)).toBe(key);
    expect(await scanDbKey(storage, () => new Uint8Array(32))).toBe(key);
  });

  it('is replaced when what is stored is not a key', async () => {
    const storage = memoryKeyValueStore({ [DB_KEY_NAME]: 'not a key' });
    expect(await scanDbKey(storage, testRandom)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the encrypted database', () => {
  it('sends the key as the very first statement, in raw form, before anything is read', async () => {
    const { module, statements, opened } = fakeSqlite();
    const db = await openEncryptedScanDb(module, KEY);
    expect(opened).toEqual([DB_NAME]);
    expect(statements[0]).toBe(`PRAGMA key = "x'${KEY}'";`);
    await db.exec('CREATE TABLE t (a)');
    await db.run('INSERT INTO t VALUES (?)', [1]);
    expect(await db.all('SELECT a FROM t')).toEqual([{ a: 1 }]);
    await db.close();
  });

  it('keeps the key out of the file name', () => {
    expect(DB_NAME).not.toContain(KEY);
  });

  it('refuses a key that is not 256 bits of hex', async () => {
    const { module } = fakeSqlite();
    await expect(openEncryptedScanDb(module, 'short')).rejects.toThrow(/64 hex/);
    await expect(openEncryptedScanDb(module, `${KEY}"; DROP TABLE t; --`)).rejects.toThrow(/64 hex/);
  });

  it('reports a file that cannot be read with this key, and closes it', async () => {
    const closeAsync = jest.fn(async () => {});
    const handle: SqliteHandle = {
      execAsync: async () => {},
      runAsync: async () => ({}),
      getAllAsync: async () => {
        throw new Error('file is not a database');
      },
      closeAsync,
    };
    const module: SqliteModule = { openDatabaseAsync: async () => handle, deleteDatabaseAsync: async () => {} };
    await expect(openEncryptedScanDb(module, KEY)).rejects.toThrow(ScanDbKeyError);
    expect(closeAsync).toHaveBeenCalled();
  });

  it('is deleted together with its key', async () => {
    const { module, deleted } = fakeSqlite();
    const storage = memoryKeyValueStore({ [DB_KEY_NAME]: KEY });
    await destroyScanDb(module, storage);
    expect(deleted).toEqual([DB_NAME]);
    expect(storage.data.has(DB_KEY_NAME)).toBe(false);
  });

  it('still removes the key when deleting the file fails', async () => {
    const module: SqliteModule = {
      openDatabaseAsync: async () => nodeHandle(),
      deleteDatabaseAsync: async () => {
        throw new Error('busy');
      },
    };
    const storage = memoryKeyValueStore({ [DB_KEY_NAME]: KEY });
    await destroyScanDb(module, storage);
    expect(storage.data.has(DB_KEY_NAME)).toBe(false);
  });
});

describe('transactions', () => {
  it('commit together and roll back together', async () => {
    const db = wrapHandle(nodeHandle());
    await db.exec('CREATE TABLE t (a INTEGER PRIMARY KEY)');
    await db.transaction(async () => {
      await db.run('INSERT INTO t VALUES (1)');
      await db.run('INSERT INTO t VALUES (2)');
    });
    await expect(
      db.transaction(async () => {
        await db.run('INSERT INTO t VALUES (3)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.all('SELECT a FROM t ORDER BY a')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('allow a transaction inside a transaction', async () => {
    const db = wrapHandle(nodeHandle());
    await db.exec('CREATE TABLE t (a INTEGER PRIMARY KEY)');
    await db.transaction(async () => {
      await db.transaction(async () => {
        await db.run('INSERT INTO t VALUES (1)');
      });
    });
    expect(await db.all('SELECT a FROM t')).toEqual([{ a: 1 }]);
  });
});
