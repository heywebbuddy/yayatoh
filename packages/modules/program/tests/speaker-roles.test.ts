import { describe, expect, it } from 'vitest';
import { groupByRole, SPEAKER_ROLES } from '../src/domain/speaker-roles.ts';

describe('speaker roles', () => {
  it('groups by role in the public order, featured first', () => {
    const people = [
      { name: 'Zed', role: 'dj', featured: false },
      { name: 'Ann', role: 'speaker', featured: false },
      { name: 'Bob', role: 'speaker', featured: true },
      { name: 'Kay', role: 'keynote', featured: false },
    ];
    const groups = groupByRole(people);
    expect(groups.map((g) => g.role)).toEqual(['keynote', 'speaker', 'dj']);
    expect(groups[1]?.people.map((p) => p.name)).toEqual(['Bob', 'Ann']);
  });

  it('lists every role the client asked for, keynote first', () => {
    expect(SPEAKER_ROLES[0]).toBe('keynote');
    expect(SPEAKER_ROLES).toHaveLength(9);
    expect(groupByRole([])).toEqual([]);
  });
});
