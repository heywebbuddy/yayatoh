import { subjectCoverage } from '@yayatoh/platform';
import { COLUMN_PRIVACY } from '@yayatoh/testing/canary';
import { describe, expect, it } from 'vitest';
import { DATA_SUBJECT_CONTRIBUTORS } from '../src/server/data-subjects.ts';

describe('the web registers every data-subject contributor (M6.1c)', () => {
  it('covers every table with a personal or holder column once, platform last', () => {
    // Declarations of tables without text columns are checked against the schema in packages/testing.
    const gaps = subjectCoverage(DATA_SUBJECT_CONTRIBUTORS, COLUMN_PRIVACY).filter(
      (p) => !p.message.includes('is not a tenant table'),
    );
    expect(gaps.map((p) => p.message)).toEqual([]);
    expect(DATA_SUBJECT_CONTRIBUTORS.at(-1)?.module).toBe('platform');
  });
});
