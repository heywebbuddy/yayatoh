import { sanitizeMarkdown } from '@yayatoh/contracts';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { sendConsoleMail } from './mail.ts';

/**
 * Site pages (legal and static, versioned), the contact details and About content, and the
 * Contact messages inbox. Every read and write goes through platform_reader, so each use lands in
 * the access log with the staff actor and a reason; writes call the SECURITY DEFINER
 * `cms.platform_save_page` / `platform_save_setting` / `contact_*` functions.
 */
type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<typeof withPlatformReader>[1]>[0];

const read = <T>(actor: string, reason: string, fn: (tx: Tx) => Promise<T>) =>
  withPlatformReader({ actor, reason: `staff console: ${reason}` }, fn);
const write = <T>(actor: string, reason: string, fn: (tx: Tx) => Promise<T>) =>
  withPlatformReader({ actor, reason: `staff console: ${reason}` }, fn, { callsWritingFunctions: true });

/* ------------------------------------------------------------------------------- pages ---- */

export interface PageRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly effectiveDate: string;
  readonly status: 'draft' | 'published';
  readonly version: number;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

const toPage = (r: Row): PageRow => ({
  id: String(r.id),
  slug: String(r.slug),
  title: String(r.title),
  body: String(r.body ?? ''),
  effectiveDate: String(r.effective_date),
  status: r.status === 'published' ? 'published' : 'draft',
  version: Number(r.version),
  updatedAt: new Date(String(r.updated_at)),
  updatedBy: String(r.updated_by),
});

const PAGE_COLUMNS = sql`id, slug, title, body, to_char(effective_date, 'YYYY-MM-DD') as effective_date, status, version, updated_at, updated_by`;

export async function listPages(actor: string): Promise<PageRow[]> {
  const rows = await read(actor, 'list site pages', (tx) =>
    tx.execute<Row>(sql`select ${PAGE_COLUMNS} from cms.platform_pages order by slug`),
  );
  return rows.map(toPage);
}

export async function getPage(actor: string, slug: string): Promise<PageRow | null> {
  const rows = await read(actor, `open site page ${slug}`, (tx) =>
    tx.execute<Row>(sql`select ${PAGE_COLUMNS} from cms.platform_pages where slug = ${slug}`),
  );
  return rows[0] ? toPage(rows[0]) : null;
}

export interface PageVersion {
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly effectiveDate: string;
  readonly status: string;
  readonly savedBy: string;
  readonly savedAt: Date;
}

export async function pageVersions(actor: string, slug: string): Promise<PageVersion[]> {
  const rows = await read(actor, `list versions of site page ${slug}`, (tx) =>
    tx.execute<Row>(
      sql`select v.version, v.title, v.body, to_char(v.effective_date, 'YYYY-MM-DD') as effective_date, v.status, v.saved_by, v.saved_at
          from cms.platform_page_versions v join cms.platform_pages p on p.id = v.page_id
          where p.slug = ${slug} order by v.version desc`,
    ),
  );
  return rows.map((r) => ({
    version: Number(r.version),
    title: String(r.title),
    body: String(r.body),
    effectiveDate: String(r.effective_date),
    status: String(r.status),
    savedBy: String(r.saved_by),
    savedAt: new Date(String(r.saved_at)),
  }));
}

export const PageInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .max(60),
  title: z.string().trim().min(1).max(160),
  body: z.string().transform((v) => sanitizeMarkdown(v, 120_000)),
  effectiveDate: z.iso.date(),
  status: z.enum(['draft', 'published']),
});
export type PageInput = z.infer<typeof PageInput>;

/** Save a page: a new version every time (the history keeps all of them). */
export async function savePage(actor: string, input: PageInput): Promise<void> {
  await write(actor, `save site page ${input.slug} (${input.status})`, (tx) =>
    tx.execute(sql`select cms.platform_save_page(${JSON.stringify(input)}::jsonb, ${actor})`),
  );
}

/* ---------------------------------------------------------------------------- settings ---- */

const t = (max: number) => z.string().trim().max(max).default('');

export const ContactSettings = z.object({
  address: t(400),
  phone: t(60),
  email: t(254),
  supportEmail: t(254),
  hours: t(200),
});
export type ContactSettings = z.infer<typeof ContactSettings>;

export const AboutSettings = z.object({
  lede: t(400),
  mission: t(800),
  story: t(4000),
  values: z.array(z.object({ title: t(80), text: t(300) })).max(8),
  attendees: t(800),
  organizers: t(800),
  team: z.array(z.object({ name: t(80), role: t(80), bio: t(300) })).max(12),
  stats: z.array(z.object({ value: t(20), label: t(60) })).max(6),
  ctaTitle: t(120),
  ctaLabel: t(60),
  ctaHref: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^(\/|https:\/\/)/.test(v)),
});
export type AboutSettings = z.infer<typeof AboutSettings>;

export async function getSetting(actor: string, key: 'contact'): Promise<ContactSettings>;
export async function getSetting(actor: string, key: 'about'): Promise<AboutSettings>;
export async function getSetting(actor: string, key: 'contact' | 'about') {
  const rows = await read(actor, `open site setting ${key}`, (tx) =>
    tx.execute<{ value: unknown }>(sql`select value from cms.platform_settings where key = ${key}`),
  );
  const value = rows[0]?.value ?? {};
  return key === 'contact'
    ? ContactSettings.parse(value)
    : AboutSettings.parse({ values: [], team: [], stats: [], ...(value as object) });
}

export async function saveSetting(
  actor: string,
  key: 'contact' | 'about',
  value: ContactSettings | AboutSettings,
): Promise<void> {
  await write(actor, `save site setting ${key}`, (tx) =>
    tx.execute(sql`select cms.platform_save_setting(${key}, ${JSON.stringify(value)}::jsonb, ${actor})`),
  );
}

/* ------------------------------------------------------------------------ contact inbox ---- */

export const CONTACT_STATUSES = ['new', 'replied', 'closed'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactMessage {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly locale: string;
  readonly status: ContactStatus;
  readonly notes: string;
  readonly lastReply: string | null;
  readonly repliedAt: Date | null;
  readonly repliedBy: string | null;
  readonly createdAt: Date;
}

const toMessage = (r: Row): ContactMessage => ({
  id: String(r.id),
  name: String(r.name),
  email: String(r.email),
  subject: String(r.subject),
  message: String(r.message),
  locale: String(r.locale),
  status: (CONTACT_STATUSES as readonly string[]).includes(String(r.status))
    ? (r.status as ContactStatus)
    : 'new',
  notes: String(r.notes ?? ''),
  lastReply: r.last_reply === null || r.last_reply === undefined ? null : String(r.last_reply),
  repliedAt: r.replied_at ? new Date(String(r.replied_at)) : null,
  repliedBy: r.replied_by === null || r.replied_by === undefined ? null : String(r.replied_by),
  createdAt: new Date(String(r.created_at)),
});

export async function listContactMessages(
  actor: string,
  status: ContactStatus | null,
): Promise<{ rows: ContactMessage[]; counts: Record<ContactStatus, number> }> {
  const [rows, counts] = await read(actor, 'list contact messages', async (tx) => [
    await tx.execute<Row>(
      status
        ? sql`select * from cms.platform_contact_messages where status = ${status} order by created_at desc limit 200`
        : sql`select * from cms.platform_contact_messages order by created_at desc limit 200`,
    ),
    await tx.execute<Row>(
      sql`select status, count(*)::int as n from cms.platform_contact_messages group by status`,
    ),
  ]);
  const by: Record<ContactStatus, number> = { new: 0, replied: 0, closed: 0 };
  for (const c of counts ?? []) by[String(c.status) as ContactStatus] = Number(c.n);
  return { rows: (rows ?? []).map(toMessage), counts: by };
}

export async function countNewContactMessages(actor: string): Promise<number> {
  const rows = await read(actor, 'count new contact messages', (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from cms.platform_contact_messages where status = 'new'`,
    ),
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getContactMessage(actor: string, id: string): Promise<ContactMessage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await read(actor, `open contact message ${id}`, (tx) =>
    tx.execute<Row>(sql`select * from cms.platform_contact_messages where id = ${id}::uuid`),
  );
  return rows[0] ? toMessage(rows[0]) : null;
}

export async function updateContactMessage(
  actor: string,
  id: string,
  status: ContactStatus,
  notes: string,
): Promise<void> {
  await write(actor, `update contact message ${id} (${status})`, (tx) =>
    tx.execute(
      sql`select cms.contact_update(${id}::uuid, ${status}, ${notes.trim().slice(0, 4000)}, ${actor})`,
    ),
  );
}

/** Email the sender (from the platform address) and mark the message replied. */
export async function replyToContactMessage(actor: string, id: string, body: string): Promise<void> {
  const m = await getContactMessage(actor, id);
  if (!m) throw new Error('unknown message');
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error('empty reply');
  const html = `<p>${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')}</p>`;
  await sendConsoleMail({
    to: m.email,
    subject: m.subject.toLowerCase().startsWith('re:') ? m.subject : `Re: ${m.subject}`,
    html,
    text,
    key: `contact-reply-${id}-${Date.now()}`,
  });
  await write(actor, `reply to contact message ${id}`, (tx) =>
    tx.execute(sql`select cms.contact_replied(${id}::uuid, ${text}, ${actor})`),
  );
}
