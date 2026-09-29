import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const commandCenterSchema = pgSchema('command_center');

/**
 * M3.2: one member's arrangement of an event's Command Center: widget order and the widgets they
 * hid. Keys are validated against the registry on write and filtered again on read, so a stale
 * or unknown key never renders.
 */
export const layouts = tenantTable(
  commandCenterSchema,
  'layouts',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    widgetOrder: text('widget_order').array().notNull().default(sql`'{}'::text[]`),
    hiddenWidgets: text('hidden_widgets').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex('layouts_org_event_user_key').on(t.orgId, t.eventId, t.userId),
    index('layouts_org_user_idx').on(t.orgId, t.userId),
    check('layouts_size_check', sql`cardinality(widget_order) <= 32 and cardinality(hidden_widgets) <= 32`),
  ],
);

/**
 * M3.2: a manual event mode set by staff or the owner (audited). No row = the computed mode.
 */
export const modeOverrides = tenantTable(
  commandCenterSchema,
  'mode_overrides',
  {
    eventId: uuid('event_id').notNull(),
    mode: text('mode').notNull(),
    setBy: uuid('set_by'),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mode_overrides_org_event_key').on(t.orgId, t.eventId),
    check('mode_overrides_mode_check', sql`mode in ('planning', 'pre_show', 'live', 'wrap')`),
  ],
);
