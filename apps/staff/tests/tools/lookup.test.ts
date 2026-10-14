import { downloadManifest, lookupHolders, type ManifestSource, queryTooShort } from '../../src/tools/lookup';
import { EVENT, fakeStaff, row, SALT } from './fixtures';

async function source(): Promise<ManifestSource> {
  return {
    salt: SALT,
    origin: 'device',
    rows: [
      await row({
        ticketId: 't1',
        shortCode: 'ADA00001',
        holderName: 'Ada Lovelace',
        email: 'ada@example.test',
        phone: '+14155550134',
      }),
      await row({
        ticketId: 't2',
        shortCode: 'ALA00002',
        holderName: 'Alan Turing',
        email: 'alan@example.test',
      }),
      await row({
        ticketId: 't3',
        shortCode: 'ADE00003',
        holderName: 'Adele Goldberg',
        email: 'adele@example.test',
        status: 'void',
      }),
    ],
    admittedToday: (id) => id === 't1',
  };
}

describe('lookup at the door', () => {
  it('finds a holder by name, every word of the query starting a word of the name', async () => {
    const r = await lookupHolders(await source(), 'ada love');
    expect(r.state).toBe('done');
    if (r.state === 'done') expect(r.matches.map((m) => m.shortCode)).toEqual(['ADA00001']);
  });

  it('finds a holder by email, an exact salted-hash match that ignores case and spaces', async () => {
    const r = await lookupHolders(await source(), '  ALAN@example.test ');
    expect(r).toMatchObject({ state: 'done', kind: 'email' });
    if (r.state === 'done') expect(r.matches.map((m) => m.holderName)).toEqual(['Alan Turing']);
  });

  it('does not match an email by a part of it', async () => {
    const r = await lookupHolders(await source(), 'alan@example');
    if (r.state === 'done') expect(r.matches).toEqual([]);
  });

  it('finds a holder by phone from its last eight digits, in any format', async () => {
    for (const q of ['+1 (415) 555-0134', '415 555 0134', '14155550134']) {
      const r = await lookupHolders(await source(), q);
      expect(r).toMatchObject({ state: 'done', kind: 'phone' });
      if (r.state === 'done') expect(r.matches.map((m) => m.shortCode)).toEqual(['ADA00001']);
    }
  });

  it('puts passes that can be used before void ones', async () => {
    const r = await lookupHolders(await source(), 'ad');
    if (r.state === 'done') expect(r.matches.map((m) => m.status)).toEqual(['active', 'void']);
  });

  it('asks for two letters before it searches a name', async () => {
    expect(queryTooShort('a')).toBe(true);
    expect(queryTooShort('  ')).toBe(true);
    expect(queryTooShort('ab')).toBe(false);
    expect(queryTooShort('a@b.co')).toBe(false);
    expect(await lookupHolders(await source(), 'a')).toEqual({ state: 'too_short', kind: 'name' });
  });

  it('shows whether this phone already admitted the ticket today', async () => {
    const r = await lookupHolders(await source(), 'ada lovelace');
    if (r.state === 'done') expect(r.matches[0]?.admittedHere).toBe(true);
    const o = await lookupHolders(await source(), 'alan');
    if (o.state === 'done') expect(o.matches[0]?.admittedHere).toBe(false);
  });

  it('never shows a field the manifest excludes: a match has exactly five fields, and no hash leaves the row', async () => {
    const r = await lookupHolders(await source(), 'ada lovelace');
    if (r.state !== 'done') throw new Error('expected matches');
    expect(Object.keys(r.matches[0] ?? {}).sort()).toEqual([
      'admittedHere',
      'holderName',
      'shortCode',
      'status',
      'ticketId',
      'typeName',
    ]);
    const text = JSON.stringify(r);
    expect(text).not.toContain('emailHash');
    expect(text).not.toContain('phoneHash');
    expect(text).not.toContain('legacy-hash');
    expect(text).not.toContain('ada@example.test');
    expect(text).not.toContain('issuedAt');
  });

  it('downloads the manifest pages through the staff route until it is complete', async () => {
    const pages = [
      { salt: SALT, rows: [await row({ ticketId: 'a' })], cursor: 'c1', complete: false },
      { salt: SALT, rows: [await row({ ticketId: 'b' })], cursor: 'c2', complete: true },
    ];
    const api = fakeStaff({
      manifestPage: async (_e, cursor) =>
        cursor ? (pages[1] as (typeof pages)[number]) : (pages[0] as (typeof pages)[number]),
    });
    const src = await downloadManifest(api, EVENT);
    expect([...src.rows].map((r) => r.ticketId)).toEqual(['a', 'b']);
    expect(src.origin).toBe('download');
    expect(api.manifestPage.mock.calls.map((c) => c[1])).toEqual([undefined, 'c1']);
  });
});
