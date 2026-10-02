import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { columnPrivacy, GLOBAL_TABLES, internal, personal } from '@yayatoh/db';
import {
  DELETE,
  type DataSubjectContributor,
  defineDataSubjectContributor,
  notSubject,
  registerDataSubjectContributors,
  subjectCoverage,
} from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import { COLUMN_PRIVACY, type Snapshot } from '../src/canary/index.ts';
import { DATA_SUBJECT_CONTRIBUTORS } from '../src/dsar/contributors.ts';

const meta = join(import.meta.dirname, '../../db/drizzle/meta');

/** Every tenant table (`schema.table`) of the newest migration snapshot. */
function tenantTables(): Set<string> {
  const journal = JSON.parse(readFileSync(join(meta, '_journal.json'), 'utf8')) as { entries: { idx: number }[] };
  const idx = Math.max(...journal.entries.map((e) => e.idx));
  const snap = JSON.parse(
    readFileSync(join(meta, `${String(idx).padStart(4, '0')}_snapshot.json`), 'utf8'),
  ) as Snapshot;
  return new Set(
    Object.values(snap.tables)
      .filter((t) => 'org_id' in t.columns && !(`${t.schema}.${t.name}` in GLOBAL_TABLES))
      .map((t) => `${t.schema}.${t.name}`),
  );
}

describe('data-subject coverage (M6.1c)', () => {
  it('every table with a personal or holder column has exactly one contributor, and every declaration is a real table', () => {
    const problems = subjectCoverage(DATA_SUBJECT_CONTRIBUTORS, COLUMN_PRIVACY, tenantTables());
    expect(problems.map((p) => p.message).join('\n')).toBe('');
  });

  it('canary: a new table with a personal column and no contributor fails, naming the line to add', () => {
    const planted = [
      ...COLUMN_PRIVACY,
      columnPrivacy('donations', {
        donors: { donor_name: personal(), donor_email: personal('email'), note: internal() },
        campaigns: { title: 'public', notes: internal() },
      }),
    ];
    const problems = subjectCoverage(DATA_SUBJECT_CONTRIBUTORS, planted, tenantTables());
    expect(problems.map((p) => p.table)).toEqual(['donations.donors']);
    expect(problems[0]?.message).toContain("'donations.donors': DELETE | REDACT | hold(basis) | notSubject(why)");
    expect(problems[0]?.message).toContain('donor_name, donor_email');
    // Declaring it closes the gap; internal-only tables need no contributor.
    const donations: DataSubjectContributor = defineDataSubjectContributor({
      module: 'donations',
      tables: { 'donations.donors': DELETE },
      export: async () => ({ sections: {} }),
      erase: async () => ({ erased: {} }),
    });
    expect(
      subjectCoverage([...DATA_SUBJECT_CONTRIBUTORS, donations], planted, new Set([...tenantTables(), 'donations.donors'])),
    ).toEqual([]);
  });

  it('refuses a table declared twice, a declaration of a table that does not exist, and a reason-less "not a subject"', () => {
    const twice = defineDataSubjectContributor({
      module: 'copy',
      tables: { 'crm.contacts': DELETE, 'ghost.rows': DELETE },
      export: async () => ({ sections: {} }),
      erase: async () => ({ erased: {} }),
    });
    const problems = subjectCoverage([...DATA_SUBJECT_CONTRIBUTORS, twice], COLUMN_PRIVACY, tenantTables());
    expect(problems.map((p) => p.table)).toEqual(['crm.contacts', 'ghost.rows']);
    expect(() => registerDataSubjectContributors([...DATA_SUBJECT_CONTRIBUTORS, twice])).toThrow(
      /crm\.contacts is declared by both crm and copy/,
    );
    registerDataSubjectContributors(DATA_SUBJECT_CONTRIBUTORS);
    expect(() =>
      defineDataSubjectContributor({
        module: 'x',
        tables: { 'x.y': notSubject('no') },
        export: async () => ({ sections: {} }),
        erase: async () => ({ erased: {} }),
      }),
    ).toThrow(/needs a reason/);
  });
});
