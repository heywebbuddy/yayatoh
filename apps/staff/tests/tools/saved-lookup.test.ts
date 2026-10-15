import { lookupHash, phoneLookupHash } from '@yayatoh/checkin-engine';
import { downloadManifest, lookupHolders } from '../../src/tools/lookup';
import { FakeServer, header, NOW, rig, row, SYNC_MS } from '../scan/harness';
import { fakeStaff } from './fixtures';

describe('lookup over the scanner’s saved manifest (offline, M7.4b engine)', () => {
  async function ready() {
    const h = await header();
    const rows = [
      row(1, {
        holderName: 'Ada Lovelace',
        emailHash: await lookupHash(h.salt, 'ada@example.test'),
        phoneHash: (await phoneLookupHash(h.salt, '+14155550134')) ?? '',
      }),
      row(2, { holderName: 'Alan Turing', emailHash: await lookupHash(h.salt, 'alan@example.test') }),
    ];
    const server = new FakeServer({ header: h, rows });
    const r = await rig(server, { at: SYNC_MS });
    await r.engine.sync();
    r.clock.ms = Date.parse(NOW);
    return { r, server };
  }

  it('has no source before a list is downloaded', async () => {
    const r = await rig(new FakeServer({ header: await header(), rows: [] }), { at: SYNC_MS });
    expect(r.engine.lookupSource).toBeNull();
  });

  it('finds guests by name, email and phone with no network at all', async () => {
    const { r, server } = await ready();
    server.online = false;
    const src = r.engine.lookupSource;
    if (!src) throw new Error('no source');
    for (const [query, name] of [
      ['ada love', 'Ada Lovelace'],
      ['alan@example.test', 'Alan Turing'],
      ['(415) 555-0134', 'Ada Lovelace'],
    ] as const) {
      const found = await lookupHolders({ ...src, origin: 'device' }, query);
      expect(found.state === 'done' && found.matches.map((m) => m.holderName)).toEqual([name]);
    }
  });

  it('can be searched again and again (the rows are not a one-shot iterator)', async () => {
    const { r } = await ready();
    const src = r.engine.lookupSource;
    if (!src) throw new Error('no source');
    const a = await lookupHolders({ ...src, origin: 'device' }, 'ada');
    const b = await lookupHolders({ ...src, origin: 'device' }, 'ada');
    expect(a).toEqual(b);
  });

  it('never shows a field the manifest excludes: only the five allowlisted fields come out', async () => {
    const { r } = await ready();
    const src = r.engine.lookupSource;
    if (!src) throw new Error('no source');
    const found = await lookupHolders({ ...src, origin: 'device' }, 'ada@example.test');
    if (found.state !== 'done') throw new Error('expected matches');
    expect(Object.keys(found.matches[0] ?? {}).sort()).toEqual([
      'admittedHere',
      'holderName',
      'shortCode',
      'status',
      'ticketId',
      'typeName',
    ]);
    expect(JSON.stringify(found)).not.toMatch(/ada@example|Hash|issuedAt|accessDates/);
  });

  it('reports who this phone already admitted today', async () => {
    const { r } = await ready();
    const code = row(1).shortCode;
    expect((await r.engine.scan(code)).verdict).toBe('admit');
    const src = r.engine.lookupSource;
    if (!src) throw new Error('no source');
    const found = await lookupHolders({ ...src, origin: 'device' }, 'ada');
    if (found.state !== 'done') throw new Error('expected matches');
    expect(found.matches.find((m) => m.holderName === 'Ada Lovelace')?.admittedHere).toBe(true);
    const other = await lookupHolders({ ...src, origin: 'device' }, 'alan');
    if (other.state !== 'done') throw new Error('expected matches');
    expect(other.matches[0]?.admittedHere).toBe(false);
  });

  it('gives the same matches as downloading the manifest through the staff route', async () => {
    const { r, server } = await ready();
    const saved = r.engine.lookupSource;
    if (!saved) throw new Error('no source');
    const staff = fakeStaff({
      manifestPage: async () => ({
        salt: (await header()).salt,
        rows: server.rows,
        cursor: null,
        complete: true,
      }),
    });
    const downloaded = await downloadManifest(staff, 'e');
    for (const q of ['ada', 'alan@example.test', '4155550134']) {
      const a = await lookupHolders({ ...saved, origin: 'device' }, q);
      const b = await lookupHolders(downloaded, q);
      expect(a.state === 'done' && a.matches.map((m) => m.ticketId)).toEqual(
        b.state === 'done' && b.matches.map((m) => m.ticketId),
      );
    }
  });

  it('is empty again once the list has expired', async () => {
    const { r } = await ready();
    r.clock.ms = Date.parse('2028-01-10T00:00:00Z');
    await r.engine.expireIfDue();
    expect(r.engine.lookupSource).toBeNull();
  });
});
