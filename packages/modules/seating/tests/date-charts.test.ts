import { describe, expect, it } from 'vitest';
import { copySeat, publicDoc } from '../src/index.ts';

const base = {
  seatUuid: '018f0000-0000-7000-8000-00000000000a',
  label: 'Row A · 1',
  itemId: '018f0000-0000-7000-8000-00000000000b',
  sectionId: null,
  ticketTypeId: '018f0000-0000-7000-8000-00000000000c',
  accessible: true,
  status: 'available',
  blockReason: null,
  groupLabel: null,
};

describe('a date gets its own copy of the plan (M1.7g copy-on-write)', () => {
  it('keeps the seat, its price, its accessibility and the organizer block', () => {
    expect(copySeat(base)).toEqual({
      seatUuid: base.seatUuid,
      label: 'Row A · 1',
      itemId: base.itemId,
      sectionId: null,
      ticketTypeId: base.ticketTypeId,
      accessible: true,
      status: 'available',
      blockReason: null,
      groupLabel: null,
    });
    for (const reason of ['channel', 'ada', 'kill'])
      expect(copySeat({ ...base, status: 'blocked', blockReason: reason })).toMatchObject({
        status: 'blocked',
        blockReason: reason,
        groupLabel: null,
      });
    expect(copySeat({ ...base, status: 'blocked', blockReason: 'group', groupLabel: 'Acme' })).toMatchObject({
      status: 'blocked',
      blockReason: 'group',
      groupLabel: 'Acme',
    });
  });

  it('never copies holds, sales or seated guests; a guest seat gets back the block it had', () => {
    expect(copySeat({ ...base, status: 'held' })).toMatchObject({ status: 'available', blockReason: null });
    expect(copySeat({ ...base, status: 'sold' })).toMatchObject({ status: 'available', blockReason: null });
    expect(copySeat({ ...base, status: 'blocked', blockReason: 'assigned' })).toMatchObject({
      status: 'available',
      blockReason: null,
    });
    expect(
      copySeat({ ...base, status: 'blocked', blockReason: 'assigned', priorBlock: 'ada' }),
    ).toMatchObject({
      status: 'blocked',
      blockReason: 'ada',
    });
    expect(
      copySeat({
        ...base,
        status: 'blocked',
        blockReason: 'assigned',
        priorBlock: 'group',
        groupLabel: 'Acme',
      }),
    ).toMatchObject({ status: 'blocked', blockReason: 'group', groupLabel: 'Acme' });
  });
});

describe('the image under a plan on public maps (M1.7g)', () => {
  const doc = {
    version: 1,
    width: 1000,
    height: 800,
    underlay: { url: '/media/o/a/f.webp', x: 0, y: 0, width: 1000, height: 800 },
    items: [],
  };
  it('is left out unless the organizer shows it', () => {
    expect(publicDoc(doc).underlay).toBeNull();
    expect(publicDoc({ ...doc, underlay: { ...doc.underlay, showOnMap: true } }).underlay?.url).toBe(
      '/media/o/a/f.webp',
    );
    expect(publicDoc({ ...doc, underlay: null }).underlay).toBeNull();
  });
});
