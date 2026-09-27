import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ANNOUNCEMENT_AUDIENCES, SECTION_KINDS, SHORT_LINK_KINDS } from './domain/content-kinds.ts';
import { events, eventsSchema } from './schema.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
const eventFk = (name: string, t: { orgId: AnyPgColumn; eventId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.orgId, t.eventId], foreignColumns: [events.orgId, events.id] }).onDelete(
    'cascade',
  );

/** M1.4c: org tags on events. `tag_key` is the case-folded form the uniqueness and filters use. */
export const eventTags = tenantTable(
  eventsSchema,
  'event_tags',
  {
    eventId: uuid('event_id').notNull(),
    tag: text('tag').notNull(),
    tagKey: text('tag_key').notNull(),
  },
  (t) => [
    uniqueIndex('event_tags_org_event_key_key').on(t.orgId, t.eventId, t.tagKey),
    index('event_tags_org_key_idx').on(t.orgId, t.tagKey),
    eventFk('event_tags_event_fk', t),
    check('event_tags_length_check', sql`char_length(tag) between 1 and 40`),
  ],
);

/** M1.4d: ordered content blocks on the event page. `content` is validated per kind (Zod). */
export const eventSections = tenantTable(
  eventsSchema,
  'event_sections',
  {
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    content: jsonb('content').notNull(),
    visible: boolean('visible').notNull().default(true),
  },
  (t) => [
    index('event_sections_org_event_position_idx').on(t.orgId, t.eventId, t.position),
    eventFk('event_sections_event_fk', t),
    check('event_sections_kind_check', sql.raw(`kind in (${list(SECTION_KINDS)})`)),
  ],
);

/** M1.4d: announcements, public or for ticket holders only. `published_at` null = draft. */
export const eventAnnouncements = tenantTable(
  eventsSchema,
  'event_announcements',
  {
    eventId: uuid('event_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: text('audience').notNull().default('public'),
    pinned: boolean('pinned').notNull().default(false),
    publishedAt: ts('published_at'),
  },
  (t) => [
    index('event_announcements_org_event_published_idx').on(t.orgId, t.eventId, t.publishedAt),
    eventFk('event_announcements_event_fk', t),
    check('event_announcements_audience_check', sql.raw(`audience in (${list(ANNOUNCEMENT_AUDIENCES)})`)),
  ],
);

/**
 * M1.4d: what only ticket holders may read (the legacy app leaked this publicly). Never joined
 * into any public function; read through `holderEventContent` after the holder link is verified.
 */
export const eventPrivateInfo = tenantTable(
  eventsSchema,
  'event_private_info',
  {
    eventId: uuid('event_id').notNull(),
    body: text('body').notNull().default(''),
    /** Online/hybrid: the join link (a bearer credential), shown near the start only. */
    joinUrl: text('join_url'),
    joinOpensMinutes: integer('join_opens_minutes').notNull().default(30),
  },
  (t) => [
    uniqueIndex('event_private_info_org_event_key').on(t.orgId, t.eventId),
    eventFk('event_private_info_event_fk', t),
    check('event_private_info_join_url_check', sql`join_url is null or join_url ~ '^https://'`),
    check('event_private_info_join_opens_check', sql`join_opens_minutes between 0 and 1440`),
  ],
);

/**
 * M1.4d: access codes unlock a private event's page and/or hidden ticket types. Codes are stored
 * upper-case (matched case-insensitively). `uses` counts successful unlocks.
 */
export const accessCodes = tenantTable(
  eventsSchema,
  'access_codes',
  {
    eventId: uuid('event_id').notNull(),
    code: text('code').notNull(),
    label: text('label'),
    unlocksEvent: boolean('unlocks_event').notNull().default(false),
    ticketTypeIds: uuid('ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: ts('expires_at'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('access_codes_org_event_code_key').on(t.orgId, t.eventId, t.code),
    eventFk('access_codes_event_fk', t),
    check('access_codes_code_check', sql`code ~ '^[A-Z0-9_-]{4,32}$'`),
    check('access_codes_max_uses_check', sql`max_uses is null or max_uses > 0`),
    check('access_codes_uses_check', sql`uses >= 0`),
    check('access_codes_unlocks_check', sql`unlocks_event or cardinality(ticket_type_ids) > 0`),
  ],
);

/** M1.4d: failed access-code attempts, per event and client key, for the attempt limit. */
export const accessCodeAttempts = tenantTable(
  eventsSchema,
  'access_code_attempts',
  {
    eventId: uuid('event_id').notNull(),
    clientKey: text('client_key').notNull(),
  },
  (t) => [
    index('access_code_attempts_org_event_client_created_idx').on(
      t.orgId,
      t.eventId,
      t.clientKey,
      t.createdAt,
    ),
    eventFk('access_code_attempts_event_fk', t),
  ],
);

/**
 * M1.4d: short links `/e/{code}`. Codes are global (they resolve before any tenant is known), so
 * they never collide across orgs; one automatic and at most one vanity code per event.
 */
export const shortLinks = tenantTable(
  eventsSchema,
  'short_links',
  {
    eventId: uuid('event_id').notNull(),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
  },
  (t) => [
    uniqueIndex('short_links_code_key').on(t.code),
    uniqueIndex('short_links_org_event_kind_key').on(t.orgId, t.eventId, t.kind),
    eventFk('short_links_event_fk', t),
    check('short_links_kind_check', sql.raw(`kind in (${list(SHORT_LINK_KINDS)})`)),
    check('short_links_code_check', sql`code ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`),
  ],
);
