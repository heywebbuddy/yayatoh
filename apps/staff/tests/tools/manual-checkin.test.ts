import { YayatohApiError } from '@yayatoh/sdk';
import { checkReason, manualCheckIn, verdictTone } from '../../src/tools/manual-checkin';
import { CHECKPOINT, EVENT, fakeStaff, testVault } from './fixtures';

const problem = (status: number) =>
  new YayatohApiError(new Response(null, { status }), { code: 'forbidden' } as never);

describe('the reason for a manual check-in', () => {
  it('asks for a reason, and a note when the reason is "other"', () => {
    expect(checkReason(null, '')).toEqual({ ok: false, problem: 'reason_missing' });
    expect(checkReason('other', ' ab ')).toEqual({ ok: false, problem: 'note_missing' });
    expect(checkReason('other', 'badge torn')).toEqual({ ok: true, text: 'other: badge torn' });
    expect(checkReason('wont_scan', '')).toEqual({ ok: true, text: 'wont_scan' });
    expect(checkReason('wont_scan', 'x'.repeat(301))).toEqual({ ok: false, problem: 'note_too_long' });
  });
});

describe('manual check-in', () => {
  const base = () => {
    const { vault } = testVault();
    return { vault, eventId: EVENT, checkpointId: CHECKPOINT, newKey: () => 'key-12345678' };
  };

  it('admits online by short code with an idempotency key and logs the reason without the name', async () => {
    const t = base();
    const api = fakeStaff();
    const r = await manualCheckIn({ ...t, api, offline: null }, { shortCode: 'ABCD2345', reason: 'wont_scan' });
    expect(r).toMatchObject({ via: 'online', result: 'admitted', holderName: 'Ada Lovelace' });
    expect(api.checkIn).toHaveBeenCalledWith({
      eventId: EVENT,
      code: 'ABCD2345',
      checkpointId: CHECKPOINT,
      idempotencyKey: 'key-12345678',
    });
    const log = await t.vault.read<Record<string, string>[]>('manual-log');
    expect(log).toHaveLength(1);
    expect(log?.[0]).toMatchObject({ shortCode: 'ABCD2345', reason: 'wont_scan', result: 'admitted', via: 'online' });
    expect(JSON.stringify(log)).not.toContain('Ada');
  });

  it('shows a duplicate with when the guest was first admitted', async () => {
    const api = fakeStaff({
      checkIn: async () => ({
        result: 'duplicate',
        holderName: 'Ada Lovelace',
        typeName: 'GA',
        shortCode: 'ABCD2345',
        firstAdmittedAt: '2026-10-20T09:00:00Z',
      }),
    });
    const r = await manualCheckIn({ ...base(), api, offline: null }, { shortCode: 'ABCD2345', reason: 'x' });
    expect(r).toMatchObject({ via: 'online', result: 'duplicate', firstAdmittedAt: '2026-10-20T09:00:00Z' });
  });

  it('decides offline with the saved manifest when the phone is offline, and does not call the server', async () => {
    const api = fakeStaff();
    const offline = { scan: jest.fn(async () => ({ verdict: 'admit', holderName: 'Ada Lovelace', typeName: 'GA' })) };
    const r = await manualCheckIn(
      { ...base(), api, offline, isOffline: () => true },
      { shortCode: 'ABCD2345', reason: 'phone_dead' },
    );
    expect(r).toMatchObject({ via: 'offline', result: 'admitted', holderName: 'Ada Lovelace' });
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(offline.scan).toHaveBeenCalledWith('ABCD2345');
  });

  it('falls back to the saved manifest when the server cannot be reached', async () => {
    const api = fakeStaff({
      checkIn: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const offline = { scan: async () => ({ verdict: 'duplicate', holderName: 'Ada Lovelace', typeName: null }) };
    const r = await manualCheckIn({ ...base(), api, offline }, { shortCode: 'ABCD2345', reason: 'x' });
    expect(r).toMatchObject({ via: 'offline', result: 'duplicate' });
  });

  it('does not fall back when the server answered (an answer is final)', async () => {
    const api = fakeStaff({
      checkIn: async () => {
        throw problem(403);
      },
    });
    const offline = { scan: jest.fn() };
    await expect(
      manualCheckIn({ ...base(), api, offline: offline as never }, { shortCode: 'ABCD2345', reason: 'x' }),
    ).rejects.toBeInstanceOf(YayatohApiError);
    expect(offline.scan).not.toHaveBeenCalled();
  });

  it('says so when there is neither a connection nor a saved manifest', async () => {
    const r = await manualCheckIn({ ...base(), api: null, offline: null }, { shortCode: 'ABCD2345', reason: 'x' });
    expect(r).toEqual({ via: 'none' });
  });

  it('keeps only the latest 500 log entries', async () => {
    const t = base();
    const api = fakeStaff();
    for (let i = 0; i < 503; i++) await manualCheckIn({ ...t, api, offline: null }, { shortCode: `C${i}`, reason: 'x' });
    const log = (await t.vault.read<unknown[]>('manual-log')) ?? [];
    expect(log).toHaveLength(500);
  });

  it('gives each result a tone: admitted is ok, a duplicate warns, everything else stops', () => {
    expect(verdictTone('admitted')).toBe('ok');
    expect(verdictTone('provisional')).toBe('ok');
    expect(verdictTone('duplicate')).toBe('warn');
    expect(verdictTone('balance_due')).toBe('warn');
    for (const r of ['invalid', 'void', 'wrong_event', 'superseded', 'wrong_checkpoint'] as const)
      expect(verdictTone(r)).toBe('stop');
  });
});
