import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns, donationsSchema } from './schema.ts';

/**
 * The live giving screen of an event (M4.8d): one per event. The campaign its thermometer follows
 * (and its QR code opens), whether donors who asked for it are thanked by name, and the link
 * version: the projector's link is signed for one version, so replacing it (`version + 1`) stops
 * every screen open on an earlier one. `(org_id, event_id)` references `events.events` (a lower
 * tier) through a hand-written foreign key (cascade).
 */
export const screens = tenantTable(
  donationsSchema,
  'screens',
  {
    eventId: uuid('event_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    showNames: boolean('show_names').notNull().default(true),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('screens_org_event_key').on(t.orgId, t.eventId),
    index('screens_org_campaign_idx').on(t.orgId, t.campaignId),
    foreignKey({
      name: 'screens_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }).onDelete('cascade'),
    check('screens_version_check', sql`version >= 1`),
  ],
);
