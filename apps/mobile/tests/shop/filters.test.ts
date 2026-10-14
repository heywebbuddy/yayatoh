import { hasFilters, NEAR_RADIUS_KM, NO_FILTERS, PAGE_SIZE, searchQuery } from '../../src/shop/filters';

describe('the search query', () => {
  it('asks for a page and nothing else when no filter is set', () => {
    expect(searchQuery(NO_FILTERS)).toEqual({ limit: PAGE_SIZE });
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('sends words, category, dates and the cursor', () => {
    const q = searchQuery(
      { q: '  jazz  ', category: 'music', range: { from: '2027-05-01', to: '2027-05-31' }, near: null },
      'abc',
    );
    expect(q).toEqual({ limit: PAGE_SIZE, q: 'jazz', category: 'music', from: '2027-05-01', to: '2027-05-31', cursor: 'abc' });
  });

  it('sends a position rounded to about a kilometre, with the radius', () => {
    const q = searchQuery({ ...NO_FILTERS, near: { lat: 38.722252, lng: -9.139337 } });
    expect(q).toMatchObject({ lat: 38.72, lng: -9.14, radiusKm: NEAR_RADIUS_KM });
  });

  it('cuts overlong words and counts a position or date as a filter', () => {
    expect(searchQuery({ ...NO_FILTERS, q: 'x'.repeat(300) }).q).toHaveLength(100);
    expect(hasFilters({ ...NO_FILTERS, q: ' ' })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, near: { lat: 1, lng: 1 } })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, range: { from: '2027-05-01', to: null } })).toBe(true);
  });
});
