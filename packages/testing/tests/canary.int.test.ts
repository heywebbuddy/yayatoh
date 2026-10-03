import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { keyVault } from '@yayatoh/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canaryToken,
  EXPORT_ALLOW,
  findCanaries,
  formatLeaks,
  leaksIn,
  PHONE_PREFIX,
  privateColumnList,
} from '../src/canary/index.ts';
import { type CanaryOrg, canaryOrg } from '../src/index.ts';

let admin: AdminSql;
let canary: CanaryOrg;

beforeAll(async () => {
  admin = adminClient();
  canary = await canaryOrg({ admin });
}, 180_000);

afterAll(async () => {
  await closePools();
  await admin.end();
});

const ident = (id: string) =>
  id
    .split('.')
    .slice(0, 2)
    .map((p) => `"${p}"`)
    .join('.');

describe('canaryOrg (roadmap §9 canary fixture)', () => {
  it('fills every registered private column (sealed ones decrypt to the canary)', async () => {
    const missing: string[] = [];
    for (const c of privateColumnList()) {
      const id = c.id;
      const col = `"${c.column}"`;
      if (c.rule.seed === 'none') {
        // Covered some other way (the reason says how); the signing key: a retired sealed row.
        expect(c.rule.why, id).toBeTruthy();
        continue;
      }
      const rows = await admin.unsafe<{ v: string }[]>(
        `select ${col}::text as v from ${ident(id)} where org_id = $1${c.rule.where ? ` and (${c.rule.where})` : ''}`,
        [canary.orgId],
      );
      let ok = false;
      for (const r of rows) {
        let text = r.v ?? '';
        if (c.rule.seed === 'sealed' || c.rule.seed === 'sealed-json')
          text = new TextDecoder().decode(await keyVault().decrypt(canary.orgId, text));
        const has =
          c.rule.seed === 'phone'
            ? text.startsWith(PHONE_PREFIX)
            : c.rule.seed === 'code'
              ? /^CANARY_\d{2}_\d+$/.test(text)
              : text.toLowerCase().includes(canaryToken(id).toLowerCase());
        ok ||= has;
      }
      if (!ok) missing.push(`${id} (${rows.length} rows)`);
      // Rows made after the fill (the fresh key and door device) hold real values.
      expect(canary.filled[id] ?? 0, id).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
  });

  it('keeps a working org: fresh API key and door token, a retired key sealed around a canary', async () => {
    expect(canary.apiKey).toMatch(/^yy_live_/);
    expect(canary.deviceToken).toMatch(/^yyd_/);
    const [key] = await admin.unsafe<{ kid: number; active: boolean; c: string }[]>(
      `select kid, active, private_key_ciphertext as c from ticketing.signing_keys where org_id = $1 and kid = 65535`,
      [canary.orgId],
    );
    expect(key?.active).toBe(false);
    expect(new TextDecoder().decode(await keyVault().decrypt(canary.orgId, key?.c ?? ''))).toBe(
      canaryToken('ticketing.signing_keys.private_key_ciphertext'),
    );
    // The public event is still published and listed.
    const [listing] = await admin.unsafe<{ n: number }[]>(
      `select count(*)::int as n from marketplace.public_listings where org_id = $1`,
      [canary.orgId],
    );
    expect(listing?.n).toBeGreaterThan(0);
  });

  it('leaves the other orgs alone', async () => {
    const [row] = await admin.unsafe<{ n: number }[]>(
      `select count(*)::int as n from orders.orders where org_id <> $1 and buyer_email like '__canary_%'`,
      [canary.orgId],
    );
    expect(row?.n).toBe(0);
  });

  it('exports made after the fill carry personal data only where their allowlist says, never secrets', () => {
    expect(canary.exports.map((e) => e.kind).sort()).toEqual([
      'attendees',
      'audience',
      'audit',
      'bookings',
      'dsar',
    ]);
    const leaks = canary.exports.flatMap((e) =>
      leaksIn(`export:${e.kind}`, e.content, { kind: 'scoped', allow: EXPORT_ALLOW[e.kind] }),
    );
    expect(formatLeaks(leaks)).toBe('no canary leaks');
    // They do contain the org's own guests (the canary is in there), so the check is live.
    const attendees = canary.exports.find((e) => e.kind === 'attendees');
    expect(findCanaries(attendees?.content ?? '').map((h) => h.column)).toContain(
      'attendees.attendees.email',
    );
    // The audience export (M3.6a) holds the org's contacts too.
    const audience = canary.exports.find((e) => e.kind === 'audience');
    expect(findCanaries(audience?.content ?? '').map((h) => h.column)).toContain('crm.contacts.email');
  });

  it('outbound messages (fake transports) never carry secrets or internal data', () => {
    expect(canary.outbound.length).toBeGreaterThan(0);
    const leaks = canary.outbound.flatMap((m, i) =>
      leaksIn(`${m.channel}#${i}`, m.payload, { kind: 'outbound' }),
    );
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  it('pushes go only to the org devices: their address is the only token they carry', () => {
    // Every push the fill caused is addressed to one of the org's canary device tokens.
    for (const to of canary.pushAddresses)
      expect(findCanaries(to).map((h) => h.column)).toEqual(['notifications.push_tokens.token']);
  });
});
