import { AUDIENCE_EXPORT_COLUMNS, audienceExportBulk, catchUpParticipation } from '@yayatoh/audiences';
import { enrollDeviceCommand } from '@yayatoh/checkin';
import { createEntryCommand, createHelpArticleCommand, createSiteSectionCommand } from '@yayatoh/cms';
import { emptySegment } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { createAnnouncementCommand, getEventBySlugQuery } from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { announcementMailer, sendAnnouncementCommand } from '@yayatoh/messaging';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { applyAccountEventCommand } from '@yayatoh/payments';
import { auditExportBulk, consumeEvent, keyVault, recentEventsTx } from '@yayatoh/platform';
import { dsarExportBulk } from '@yayatoh/privacy';
import { attendeeExportBulk, BOOKING_EXPORT_COLUMNS, bookingsExportBulk } from '@yayatoh/reports';
import { hideReviewCommand } from '@yayatoh/reviews';
import {
  API_KEY_SCOPES,
  completeOnboardingCommand,
  createApiKeyCommand,
  setLegalPageCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { createOrgFixture, EXPORT_PARAMS, FIXTURE_SITE_PASSWORD, systemCtx, userCtx } from '../fixtures.ts';
import { ports, runBulk } from '../ports.ts';
import {
  canaryToken,
  codeColumns,
  PHONE_PREFIX,
  phoneColumns,
  privateColumnList,
  seedOf,
} from './registry.ts';

type Row = Record<string, unknown>;
/**
 * A superuser connection (postgres.js shape). Some private columns sit in tables the app role can
 * only append to (audit, ledger, outbox), so the fill runs as the database owner with triggers off.
 * Tests pass `adminClient()` from `@yayatoh/db/testing`.
 */
export interface CanaryAdmin {
  begin(
    fn: (tx: { unsafe(query: string, params?: unknown[]): PromiseLike<Row[]> }) => Promise<unknown>,
  ): PromiseLike<unknown>;
  unsafe(query: string, params?: unknown[]): PromiseLike<Row[]>;
}

export interface CanaryFile {
  readonly name: string;
  readonly kind: 'attendees' | 'bookings' | 'dsar' | 'audit' | 'audience';
  readonly content: string;
}

export interface CanaryOrg {
  readonly orgId: string;
  readonly slug: string;
  readonly ownerId: string;
  /** Its tenant site (`{slug}.yayatoh.events`). */
  readonly tenantHost: string;
  readonly event: { readonly id: string; readonly slug: string };
  /** A fresh org API key with every scope, minted after the fill. */
  readonly apiKey: string;
  /** A fresh door device token (the Scan PWA's credential), minted after the fill. */
  readonly deviceToken: string;
  /** The org's exports, generated after the fill. */
  readonly exports: readonly CanaryFile[];
  /** Outbound messages captured through the fake transports after the fill. */
  readonly outbound: readonly { readonly channel: string; readonly payload: string }[];
  /** Private columns filled (id → rows written). */
  readonly filled: Readonly<Record<string, number>>;
  /** M4.5a: the fixture event's guest website (published) and its password. */
  readonly guestSite: { readonly code: string; readonly password: string };
}

const ident = (...parts: string[]) => parts.map((p) => `"${p.replace(/"/g, '""')}"`).join('.');

/**
 * The canary org (roadmap §9 seed `canary`): a separate org (the isolation suite's two orgs are
 * untouched) with everything `createOrgFixture` builds (a published public event, tickets, an
 * order, attendees, seating, content, a venue, messages, notifications, exports …), a tenant site,
 * the widget enabled, a holders-only announcement, a draft page, a hidden review and a retired
 * signing key; then every registered
 * private column is overwritten with `__CANARY_<schema>.<table>.<column>__` (shaped for emails,
 * phones and URLs; sealed through the org's key vault where the app stores ciphertext).
 *
 * With `reuse`, an org that already has this slug is refilled instead of created again (the e2e
 * database survives reruns).
 */
export async function canaryOrg(o: {
  admin: CanaryAdmin;
  slug?: string;
  reuse?: boolean;
}): Promise<CanaryOrg> {
  const slug = o.slug ?? `canary-${Date.now().toString(36)}`;
  const existing = o.reuse
    ? await o.admin.unsafe(
        `select o.id, m.user_id from tenancy.organizations o
         join tenancy.memberships m on m.org_id = o.id and m.role = 'owner' where o.slug = $1 limit 1`,
        [slug],
      )
    : [];
  let orgId: string;
  let ownerId: string;
  if (existing[0]) {
    orgId = existing[0].id as string;
    ownerId = existing[0].user_id as string;
  } else {
    const f = await createOrgFixture(slug, 'Canary Leak Check');
    orgId = f.org.id;
    ownerId = f.ownerId;
    await prepare(o.admin, orgId, ownerId, f.event.id);
  }
  const ctx = () => userCtx(ownerId, orgId);
  const event = await executeQuery(getEventBySlugQuery, { slug: `${slug}-launch` }, ctx(), ports);

  const filled = await fill(o.admin, orgId);

  const { key: apiKey } = await executeCommand(
    createApiKeyCommand,
    { name: 'Canary crawler', scopes: [...API_KEY_SCOPES] },
    ctx(),
    ports,
  );
  const { token: deviceToken } = await executeCommand(
    enrollDeviceCommand,
    { label: 'Canary door' },
    ctx(),
    ports,
  );
  const exports = await generateExports(orgId, ctx, event.id, slug);
  const outbound = await sendOutbound(orgId, ctx, event.id);
  const [site] = await o.admin.unsafe(
    `select code from guests.sites where org_id = $1 and event_id = $2 and status = 'published'`,
    [orgId, event.id],
  );
  if (!site) throw new Error('canary: the fixture event has no published guest website');
  return {
    orgId,
    slug,
    ownerId,
    tenantHost: `${slug}.yayatoh.events`,
    event: { id: event.id, slug: event.slug },
    apiKey,
    deviceToken,
    exports,
    outbound,
    filled,
    guestSite: { code: site.code as string, password: FIXTURE_SITE_PASSWORD },
  };
}

/** One-time extras beyond the shared fixture. */
async function prepare(admin: CanaryAdmin, orgId: string, ownerId: string, eventId: string) {
  const ctx = () => userCtx(ownerId, orgId);
  // M4.8a: a connected account, so the giving page shows the fixture's campaign (gifts need one).
  const [account] = await admin.unsafe(
    `select account_id from payments.payment_accounts where org_id = $1 limit 1`,
    [orgId],
  );
  if (!account) throw new Error('canary: the fixture has no payout account');
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_canary_${orgId}`,
      type: 'account.updated',
      orgId,
      account: {
        accountId: account.account_id as string,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    systemCtx(orgId),
    ports,
  );
  await executeCommand(
    updateSiteSettingsCommand,
    { listOnMarketplace: true, tenantSite: true, embedOrigins: ['https://canary-embed.test'] },
    ctx(),
    ports,
  );
  await executeCommand(
    createAnnouncementCommand,
    { eventId, title: 'Holders only', body: 'Bring your ticket.', audience: 'holders', publish: true },
    ctx(),
    ports,
  );
  // M1.4g: a draft page (drafts are private; published entries are public) and the fixture's
  // review hidden by the organizer (a hidden review's name and text are private).
  await executeCommand(
    createEntryCommand,
    { kind: 'page', title: 'Draft page', body: 'Not yet.', authorName: 'Canary Owner' },
    ctx(),
    ports,
  );
  // M3.11b: a draft help article and a draft marketing section (private until published).
  const [helpCategory] = await admin.unsafe(
    `select id::text as id from cms.help_categories where org_id = $1 limit 1`,
    [orgId],
  );
  if (!helpCategory) throw new Error('canary: the fixture has no help category');
  await executeCommand(
    createHelpArticleCommand,
    { categoryId: helpCategory.id as string, title: 'Draft help article', body: 'Not yet.' },
    ctx(),
    ports,
  );
  await executeCommand(
    createSiteSectionCommand,
    { placement: 'features', heading: 'Draft section', body: 'Not yet.' },
    ctx(),
    ports,
  );
  const [review] = await admin.unsafe(
    `select id::text as id, event_id::text as event_id from reviews.reviews where org_id = $1 limit 1`,
    [orgId],
  );
  if (!review) throw new Error('canary: the fixture has no review to hide');
  await executeCommand(
    hideReviewCommand,
    { eventId: review.event_id as string, reviewId: review.id as string, reason: 'Canary: hidden review' },
    ctx(),
    ports,
  );
  // A retired signing key sealed around a canary (the active key must keep signing).
  const sealed = await keyVault().encrypt(
    orgId,
    new TextEncoder().encode(canaryToken('ticketing.signing_keys.private_key_ciphertext')),
  );
  await withTenant(systemCtx(orgId), (tx) =>
    tx.execute(sql`insert into ticketing.signing_keys (org_id, kid, public_key, private_key_ciphertext, active)
      select org_id, 65535, public_key, ${sealed}, false from ticketing.signing_keys where active limit 1`),
  );
  // M3.11a: a finished onboarding (a privacy notice, then Finish setup), so who finished it is
  // recorded and covered.
  await executeCommand(
    setLegalPageCommand,
    { kind: 'privacy', body: 'Canary privacy notice.' },
    ctx(),
    ports,
  );
  await executeCommand(completeOnboardingCommand, {}, ctx(), ports);
  // An unpaid direct-charge order (organizer_mor), so the connected account column holds a value.
  await admin.unsafe(
    `insert into orders.orders
     select (jsonb_populate_record(null::orders.orders, to_jsonb(o) || jsonb_build_object(
       'id', gen_random_uuid(), 'status', 'expired', 'funds_flow', 'organizer_mor',
       'connected_account_id', 'acct_canary', 'provider_payment_id', null, 'paid_at', null,
       'manage_token_hash', md5(random()::text)))).*
     from orders.orders o where org_id = $1 order by created_at limit 1`,
    [orgId],
  );
  // M5.1d: a pending pay-link invoice payment on a direct-charge flow, so its connected account
  // column holds a value too.
  await admin.unsafe(
    `insert into orders.invoice_payments
     select (jsonb_populate_record(null::orders.invoice_payments, to_jsonb(p) || jsonb_build_object(
       'id', gen_random_uuid(), 'channel', 'pay_link', 'method', 'card', 'status', 'pending',
       'funds_flow', 'organizer_mor', 'connected_account_id', 'acct_canary', 'received_on', null,
       'completed_at', null, 'fee_part_minor', 0, 'idempotency_key', md5(random()::text)))).*
     from orders.invoice_payments p where org_id = $1 order by created_at limit 1`,
    [orgId],
  );
}

/** Writes the canaries into every registered private column of the org (every row). */
async function fill(admin: CanaryAdmin, orgId: string): Promise<Record<string, number>> {
  const types = new Map(
    (
      await admin.unsafe(
        `select table_schema || '.' || table_name || '.' || column_name as id,
                case when data_type = 'ARRAY' then ltrim(udt_name, '_') || '[]' else data_type end as type
         from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema')`,
      )
    ).map((r) => [r.id as string, r.type as string]),
  );
  const phones = phoneColumns();
  const codes = codeColumns();
  const sealedRows: { id: string; rowId: string; value: string | null; json: boolean }[] = [];
  const filled: Record<string, number> = {};
  await admin.begin(async (tx) => {
    // The fill rewrites append-only rows (audit chain, outbox, ledger): triggers stay quiet.
    await tx.unsafe('set local session_replication_role = replica');
    for (const c of privateColumnList()) {
      const type = types.get(c.id);
      if (!type) throw new Error(`canary: ${c.id} is registered but missing from the database`);
      const seed = seedOf(c.rule, type);
      if (seed === 'none') continue;
      const table = ident(c.schema, c.table);
      const col = ident(c.column);
      const where = `org_id = $1${c.rule.where ? ` and (${c.rule.where})` : ''}`;
      const token = canaryToken(c.id);
      if (seed === 'sealed' || seed === 'sealed-json') {
        const rows = await tx.unsafe(`select id::text as id, ${col} as v from ${table} where ${where}`, [
          orgId,
        ]);
        for (const r of rows)
          sealedRows.push({
            id: c.id,
            rowId: r.id as string,
            value: r.v as string | null,
            json: seed === 'sealed-json',
          });
        filled[c.id] = rows.length;
        continue;
      }
      // A stable per-row suffix: unique columns stay unique and a refill writes the same values.
      const suffix = `r.n::text`;
      const value = {
        text: `$2 || ${suffix}`,
        email: `lower($2) || ${suffix} || '@canary.test'`,
        phone: `'${PHONE_PREFIX}${Math.max(0, phones.indexOf(c.id))}' || lpad((r.n % 1000)::text, 3, '0') || left($2, 0)`,
        url: `'https://canary.test/' || $2 || ${suffix}`,
        path: `'/' || $2 || ${suffix}`,
        'key-prefix': `left(t.${col}, 8) || $2 || ${suffix}`,
        code: `'CANARY_${String(codes.indexOf(c.id)).padStart(2, '0')}_' || r.n::text || left($2, 0)`,
        json: `case jsonb_typeof(t.${col})
                 when 'object' then t.${col} || jsonb_build_object('__canary', $2 || ${suffix})
                 when 'array' then t.${col} || jsonb_build_array($2 || ${suffix})
                 else jsonb_build_object('__canary', $2 || ${suffix}) end`,
        // Idempotent (a refill on a reused org must not grow the array).
        array: `case when ($2 || ${suffix}) = any(coalesce(t.${col}, '{}')) then t.${col}
                 else array_append(coalesce(t.${col}, '{}'), $2 || ${suffix}) end`,
      }[seed];
      const res = await tx.unsafe(
        `with r as (select ctid, abs(hashtext(id::text)) % 100000000 as n from ${table} where ${where})
         update ${table} t set ${col} = ${value} from r where t.ctid = r.ctid returning 1`,
        [orgId, token],
      );
      filled[c.id] = res.length;
    }
  });
  // Sealed columns: the plaintext is the canary (or gains one), encrypted with the org's key.
  for (const r of sealedRows) {
    let plain = canaryToken(r.id);
    if (r.json) {
      const prior = r.value
        ? (JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, r.value))) as Row)
        : {};
      plain = JSON.stringify({ ...prior, __canary: canaryToken(r.id) });
    }
    const sealed = await keyVault().encrypt(orgId, new TextEncoder().encode(plain));
    const [schema = '', table = '', column = ''] = r.id.split('.');
    await admin.unsafe(`update ${ident(schema, table)} set ${ident(column)} = $1 where id = $2`, [
      sealed,
      r.rowId,
    ]);
  }
  return filled;
}

async function generateExports(
  orgId: string,
  ctx: () => ReturnType<typeof userCtx>,
  eventId: string,
  slug: string,
): Promise<CanaryFile[]> {
  const out: CanaryFile[] = [];
  const run = async (
    kind: CanaryFile['kind'],
    start: () => Promise<{ operationId: string }>,
    file: (operationId: string) => Promise<{ name: string; content: string }>,
  ) => {
    const { operationId } = await start();
    await runBulk(orgId, operationId);
    const f = await file(operationId);
    out.push({ kind, name: f.name, content: f.content });
  };
  await run(
    'attendees',
    () =>
      executeCommand(
        attendeeExportBulk.start,
        { eventId, selection: { filter: {} }, params: EXPORT_PARAMS },
        ctx(),
        ports,
      ),
    (operationId) => executeQuery(attendeeExportBulk.file, { operationId }, ctx(), ports),
  );
  await run(
    'bookings',
    () =>
      executeCommand(
        bookingsExportBulk.start,
        {
          eventId,
          selection: { filter: { q: '', filter: 'all' } },
          params: {
            headers: Object.fromEntries(BOOKING_EXPORT_COLUMNS.map((c) => [c, c])) as Record<
              (typeof BOOKING_EXPORT_COLUMNS)[number],
              string
            >,
            statuses: { paid: 'Paid', refunded: 'Refunded' },
            channels: { platform: 'Online', organizer: 'Box office' },
          },
        },
        ctx(),
        ports,
      ),
    (operationId) => executeQuery(bookingsExportBulk.file, { operationId }, ctx(), ports),
  );
  // The data-subject access file of a guest whose email is now a canary.
  const [guest] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ email: string }>(sql`select email from attendees.attendees order by created_at limit 1`),
  );
  const email = guest?.email ?? `nobody@${slug}.test`;
  await run(
    'dsar',
    () =>
      executeCommand(
        dsarExportBulk.start,
        { selection: { filter: { email } }, params: { email, orgName: 'Canary Leak Check' } },
        ctx(),
        ports,
      ),
    (operationId) => executeQuery(dsarExportBulk.file, { operationId }, ctx(), ports),
  );
  await run(
    'audit',
    () =>
      executeCommand(
        auditExportBulk.start,
        {
          selection: { filter: {} },
          params: {
            headers: {
              seq: '#',
              at: 'When',
              actor: 'Who',
              action: 'What',
              targetType: 'Target type',
              targetId: 'Target',
              details: 'Details',
            },
            timeZone: 'UTC',
          },
        },
        ctx(),
        ports,
      ),
    (operationId) => executeQuery(auditExportBulk.file, { operationId }, ctx(), ports),
  );
  // M3.6a: everyone in the org as an audience (contacts and their profiles, canaries included).
  await catchUpParticipation(orgId);
  await run(
    'audience',
    () =>
      executeCommand(
        audienceExportBulk.start,
        {
          selection: { filter: { definition: emptySegment() } },
          params: {
            headers: Object.fromEntries(AUDIENCE_EXPORT_COLUMNS.map((c) => [c, c])) as Record<
              (typeof AUDIENCE_EXPORT_COLUMNS)[number],
              string
            >,
            consent: { granted: 'Given', withdrawn: 'Withdrawn', unknown_legacy: 'Unknown', none: 'No' },
          },
        },
        ctx(),
        ports,
      ),
    (operationId) => executeQuery(audienceExportBulk.file, { operationId }, ctx(), ports),
  );
  return out;
}

/** An announcement to the event's (canary) attendees, sent through the fake transports. */
async function sendOutbound(orgId: string, ctx: () => ReturnType<typeof userCtx>, eventId: string) {
  const mem = memoryTransports();
  const sent = await executeCommand(
    sendAnnouncementCommand,
    { eventId, subject: 'Canary check', body: 'Doors at seven.', channels: ['email'] },
    { ...ctx(), idempotencyKey: `canary-announcement-${Date.now()}` },
    ports,
  );
  const events = await withTenant(systemCtx(orgId), (tx) =>
    recentEventsTx(tx, orgId, ['announcement.sent'], 3_600_000),
  );
  const mine = events.find((e) => e.aggregateId === sent.id) ?? events[0];
  if (mine)
    await consumeEvent(
      announcementMailer({ notifier: createNotifier(), appOrigin: 'https://app.yayatoh.test' }),
      mine,
    );
  await dispatchDue(orgId, {
    transports: mem.transports,
    appOrigin: 'https://app.yayatoh.test',
    ignoreQuietHours: true,
  });
  return [
    ...mem.emails.map((m) => ({ channel: 'email', payload: JSON.stringify(m) })),
    ...mem.sms.map((m) => ({ channel: 'sms', payload: JSON.stringify(m) })),
    ...mem.pushes.map((m) => ({ channel: 'push', payload: JSON.stringify(m) })),
  ];
}
