import { describe, expect, it } from 'vitest';
import { type FinderParty, partyOnChart } from '../src/domain/guest-finder.ts';

const g = (
  id: string,
  name: string | null,
  status: 'attending' | 'pending' | 'declined' = 'attending',
  guestOf: string | null = null,
) => ({
  id,
  name,
  guestOf,
  status,
});
const parties: FinderParty[] = [
  {
    id: 'garcia',
    guests: [g('luis', 'Luis Garcia'), g('ana', 'Ana Garcia'), g('p1', null, 'pending', 'Luis Garcia')],
  },
  { id: 'chen', guests: [g('mei', 'Mei Chen'), g('jun', 'Jun Chen', 'declined')] },
  { id: 'okafor', guests: [g('ada', 'Ada Okafor', 'pending')] },
];
const places = [
  { itemId: 't1', kind: 'table' as const, label: '1' },
  { itemId: 't2', kind: 'table' as const, label: '2' },
  { itemId: 'rA', kind: 'row' as const, label: 'A' },
];

describe('guest seat finder (M4.4a)', () => {
  it("lists the party's places in plan order with tablemates as the host named them", () => {
    const r = partyOnChart({
      partyId: 'garcia',
      parties,
      places,
      placed: [
        { guestId: 'luis', itemId: 't2' },
        { guestId: 'ana', itemId: 't1' },
        { guestId: 'p1', itemId: 't2' },
        { guestId: 'mei', itemId: 't2' },
        { guestId: 'jun', itemId: 't2' },
        { guestId: 'ada', itemId: 't1' },
      ],
    });
    expect(r?.places.map((p) => p.label)).toEqual(['1', '2']);
    expect(r?.places[0]?.guests).toEqual([{ id: 'ana', name: 'Ana Garcia', guestOf: null }]);
    expect(r?.places[0]?.tablemates).toEqual([{ name: 'Ada Okafor', guestOf: null }]);
    // An unnamed plus-one reads "Guest of …"; a declined guest still seated is nobody's tablemate.
    expect(r?.places[1]?.guests.map((x) => x.guestOf ?? x.name)).toEqual(['Luis Garcia', 'Luis Garcia']);
    expect(r?.places[1]?.tablemates).toEqual([{ name: 'Mei Chen', guestOf: null }]);
    expect(r?.unseated).toEqual([]);
  });

  it('names who has no place yet, including places on a table the chart lost', () => {
    const r = partyOnChart({
      partyId: 'garcia',
      parties,
      places,
      placed: [
        { guestId: 'luis', itemId: 'gone' },
        { guestId: 'ana', itemId: 'rA' },
      ],
    });
    expect(r?.places.map((p) => [p.kind, p.label])).toEqual([['row', 'A']]);
    expect(r?.unseated.map((x) => x.id)).toEqual(['luis', 'p1']);
  });

  it('leaves declined guests out and a party with nobody coming off the chart', () => {
    const chen = partyOnChart({
      partyId: 'chen',
      parties,
      places,
      placed: [{ guestId: 'jun', itemId: 't1' }],
    });
    expect(chen?.places).toEqual([]);
    expect(chen?.unseated.map((x) => x.id)).toEqual(['mei']);
    const allDeclined: FinderParty[] = [{ id: 'x', guests: [g('x1', 'X One', 'declined')] }];
    expect(partyOnChart({ partyId: 'x', parties: allDeclined, places, placed: [] })).toBeNull();
    expect(partyOnChart({ partyId: 'nobody', parties, places, placed: [] })).toBeNull();
  });

  it('never lists the party itself among its tablemates', () => {
    const r = partyOnChart({
      partyId: 'garcia',
      parties,
      places,
      placed: [
        { guestId: 'luis', itemId: 't1' },
        { guestId: 'ana', itemId: 't1' },
      ],
    });
    expect(r?.places[0]?.tablemates).toEqual([]);
  });
});
