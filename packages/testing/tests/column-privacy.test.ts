import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOBAL_TABLES } from '@yayatoh/db';
import { describe, expect, it } from 'vitest';
import {
  COLUMN_PRIVACY,
  columnCoverage,
  phoneColumns,
  privateColumnList,
  registeredColumns,
  type Snapshot,
} from '../src/canary/index.ts';

const root = join(import.meta.dirname, '../../..');
const meta = join(root, 'packages/db/drizzle/meta');

/** The snapshot of the newest migration (the journal's last entry). */
function latestSnapshot(): Snapshot {
  const journal = JSON.parse(readFileSync(join(meta, '_journal.json'), 'utf8')) as {
    entries: { idx: number }[];
  };
  const idx = Math.max(...journal.entries.map((e) => e.idx));
  return JSON.parse(readFileSync(join(meta, `${String(idx).padStart(4, '0')}_snapshot.json`), 'utf8'));
}

/** schema → the file that declares its columns (found from `pgSchema('…')` in the sources). */
function owners(): (schema: string) => string {
  const map = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'tests') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/pgSchema\(\s*['"](\w+)['"]\s*\)/g))
          map.set(m[1] as string, `${p.slice(root.length + 1).replace(/\/src\/.*$/, '')}/src/private-columns.ts`);
      }
    }
  };
  walk(join(root, 'packages'));
  return (schema) => map.get(schema) ?? `the package that owns schema "${schema}"`;
}

describe('column-privacy registry (roadmap §9 canary leak test)', () => {
  it('declares every text, jsonb and text[] column of every tenant table, and nothing else', () => {
    const problems = columnCoverage(latestSnapshot(), COLUMN_PRIVACY, GLOBAL_TABLES, owners());
    expect(problems.map((p) => p.message).join('\n')).toBe('');
  });

  it('fails on a new tenant table nobody declared, naming the file and the line to add', () => {
    const snap = latestSnapshot();
    const planted: Snapshot = {
      tables: {
        ...snap.tables,
        'events.speakers': {
          schema: 'events',
          name: 'speakers',
          columns: { id: { type: 'uuid' }, org_id: { type: 'uuid' }, bio: { type: 'text' }, notes: { type: 'jsonb' } },
        },
        'media.assets': {
          schema: 'media',
          name: 'assets',
          columns: { org_id: { type: 'uuid' }, alt: { type: 'text' }, tags: { type: 'text[]' } },
        },
      },
    };
    const problems = columnCoverage(planted, COLUMN_PRIVACY, GLOBAL_TABLES, owners());
    expect(problems.map((p) => p.id)).toEqual([
      'events.speakers.bio',
      'events.speakers.notes',
      'media.assets.alt',
      'media.assets.tags',
    ]);
    expect(problems[0]?.message).toContain('packages/modules/events/src/private-columns.ts: under `speakers`');
    expect(problems[0]?.message).toContain("bio: 'public' | 'vocab' | secret() | personal()");
    expect(problems[2]?.message).toContain("columnPrivacy('media', { assets: { … } })");
    expect(problems[2]?.message).toContain('COLUMN_PRIVACY');
  });

  it('fails on a stale entry and on a seed that does not fit the column', () => {
    const snap = latestSnapshot();
    const renamed: Snapshot = {
      tables: Object.fromEntries(
        Object.entries(snap.tables).map(([k, t]) =>
          k === 'orders.orders'
            ? [
                k,
                {
                  ...t,
                  columns: Object.fromEntries(
                    Object.entries(t.columns).map(([c, d]) => [c === 'buyer_email' ? 'buyer_mail' : c, d]),
                  ),
                },
              ]
            : [k, t],
        ),
      ),
    };
    const ids = columnCoverage(renamed, COLUMN_PRIVACY, GLOBAL_TABLES, owners()).map((p) => p.id);
    expect(ids).toEqual(['orders.orders.buyer_mail', 'orders.orders.buyer_email']);
    const bad = columnCoverage(
      snap,
      [
        {
          schema: 'orders',
          tables: { orders: { buyer_email: { class: 'personal', seed: 'json' } } },
        },
        { schema: 'orders', tables: { refunds: { note: { class: 'internal', seed: 'none' } } } },
      ],
      GLOBAL_TABLES,
      owners(),
    ).map((p) => p.message);
    expect(bad).toContain("orders.orders.buyer_email: seed 'json' does not fit the column type text");
    expect(bad).toContain("orders.refunds.note: seed 'none' needs a `why` (where is its exposure covered?)");
  });

  it('covers the private data the legacy app leaked and the roadmap names', () => {
    const cls = new Map(privateColumnList().map((c) => [c.id, c.rule.class]));
    // Payout/bank and provider ids, tokens and hashes: secret.
    for (const id of [
      'payments.payment_accounts.account_id',
      'payments.settlements.destination_account_id',
      'orders.orders.manage_token_hash',
      'orders.orders.manage_token_ciphertext',
      'tenancy.api_keys.key_hash',
      'checkin.devices.token_hash',
      'notifications.push_tokens.token',
      'ticketing.signing_keys.private_key_ciphertext',
    ])
      expect([id, cls.get(id)]).toEqual([id, 'secret']);
    for (const id of [
      'orders.orders.buyer_email',
      'ticketing.tickets.holder_email',
      'crm.contacts.phone_e164',
      'forms.form_responses.answers',
      'venues.quote_requests.message',
    ])
      expect([id, cls.get(id)]).toEqual([id, 'personal']);
    for (const id of [
      'events.event_private_info.join_url',
      'events.event_private_info.body',
      'events.access_codes.code',
    ])
      expect([id, cls.get(id)]).toEqual([id, 'holder']);
    for (const id of ['orders.refunds.note', 'messaging.reports.note', 'platform.audit_events.data'])
      expect([id, cls.get(id)]).toEqual([id, 'internal']);
  });

  it('phone canaries fit the one-digit column index', () => {
    expect(phoneColumns().length).toBeGreaterThan(0);
    expect(phoneColumns().length).toBeLessThanOrEqual(10);
    expect(new Set(registeredColumns().map((c) => c.id)).size).toBe(registeredColumns().length);
  });
});
