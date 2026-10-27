import { describe, expect, it } from 'vitest';
import { bareItemLabel, buildRoundTable, placedSeats } from '../src/index.ts';

describe('bareItemLabel', () => {
  it('drops a leading table or row word so "Table {label}" never doubles', () => {
    expect(bareItemLabel('Table 1')).toBe('1');
    expect(bareItemLabel('table 12')).toBe('12');
    expect(bareItemLabel('Row A')).toBe('A');
    expect(bareItemLabel('Tisch 4')).toBe('4');
    expect(bareItemLabel('Mesa 3')).toBe('3');
    expect(bareItemLabel('Table: VIP')).toBe('VIP');
    expect(bareItemLabel('桌3')).toBe('3');
  });
  it('leaves other labels alone', () => {
    expect(bareItemLabel('7')).toBe('7');
    expect(bareItemLabel('Head table')).toBe('Head table');
    expect(bareItemLabel('Tablet')).toBe('Tablet');
    expect(bareItemLabel('Table')).toBe('Table');
    expect(bareItemLabel('  Rose  ')).toBe('Rose');
  });
  it('builds seat labels without a doubled word', () => {
    const t = buildRoundTable({ label: 'Table 1', seats: 2, x: 0, y: 0 });
    const doc = { items: [t] } as never;
    expect(placedSeats(doc)[0]?.label).toBe('Table 1 · 1');
  });
});
