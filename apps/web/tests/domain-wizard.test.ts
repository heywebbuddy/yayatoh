import { describe, expect, it } from 'vitest';
import { wizardStates, wizardStep } from '../src/lib/domain-wizard.ts';

const d = (o: Partial<Parameters<typeof wizardStep>[0]> = {}) => ({
  managed: false,
  status: 'pending_dns' as const,
  sslStatus: null,
  isPrimary: false,
  ...o,
});

describe('domain connect wizard (U3)', () => {
  it('walks DNS → verify → certificate → primary → done', () => {
    expect(wizardStep(d())).toBe('dns');
    expect(wizardStep(d({ status: 'failed' }))).toBe('dns');
    expect(wizardStep(d({ status: 'verifying' }))).toBe('verify');
    expect(wizardStep(d({ status: 'active', sslStatus: 'pending' }))).toBe('ssl');
    expect(wizardStep(d({ status: 'active', sslStatus: null }))).toBe('ssl');
    expect(wizardStep(d({ status: 'active', sslStatus: 'issued' }))).toBe('primary');
    expect(wizardStep(d({ status: 'active', sslStatus: 'issued', isPrimary: true }))).toBe('done');
  });

  it('the managed subdomain has nothing to set up', () => {
    expect(wizardStep(d({ managed: true }))).toBe('done');
  });

  it('marks earlier steps done, the current one current, later ones to do', () => {
    expect(wizardStates(d({ status: 'verifying' })).map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
    expect(wizardStates(d()).map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(
      wizardStates(d({ status: 'active', sslStatus: 'issued', isPrimary: true })).every(
        (s) => s.state === 'done',
      ),
    ).toBe(true);
  });
});
