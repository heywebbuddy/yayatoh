import type { PlantCtx, Planter } from '../types.ts';
import { plantAssistance } from './assistance.ts';
import { plantAttendees } from './attendees.ts';
import { plantAutomations } from './automations.ts';
import { plantBadges } from './badges.ts';
import { plantCampaigns } from './campaigns.ts';
import { plantCheckin } from './checkin.ts';
import { plantCms } from './cms.ts';
import { plantCrm } from './crm.ts';
import { plantDonations, plantDonationsCollection } from './donations.ts';
import { plantEngagement, plantNetworking } from './engagement.ts';
import { plantEvents } from './events.ts';
import { plantForms } from './forms.ts';
import { plantGallery } from './gallery.ts';
import { plantGuests } from './guests.ts';
import { plantLeads } from './leads.ts';
import { plantMarketing } from './marketing.ts';
import { plantMedia } from './media.ts';
import { plantMessaging } from './messaging.ts';
import { plantNotifications } from './notifications.ts';
import { plantOrders } from './orders.ts';
import { plantPayments } from './payments.ts';
import { plantCfp, plantProgram } from './program.ts';
import { plantRegistration } from './registration.ts';
import { plantReviews } from './reviews.ts';
import { plantSeating } from './seating.ts';
import { plantSurveys } from './surveys.ts';
import { plantTenancy } from './tenancy.ts';
import { plantTicketing } from './ticketing.ts';
import { plantVenues } from './venues.ts';

/** In order: later planters read the ids earlier ones made (contact, order, ticket, attendee). */
export const PLANTERS: readonly (readonly [string, Planter])[] = [
  ['crm', plantCrm],
  ['orders', plantOrders],
  ['ticketing', plantTicketing],
  ['attendees', plantAttendees],
  ['forms', plantForms],
  ['checkin', plantCheckin],
  ['tenancy', plantTenancy],
  ['notifications', plantNotifications],
  ['seating', plantSeating],
  ['guests', plantGuests],
  ['messaging', plantMessaging],
  ['assistance', plantAssistance],
  ['program', plantProgram],
  ['events', plantEvents],
  ['media', plantMedia],
  ['cms', plantCms],
  ['venues', plantVenues],
  ['reviews', plantReviews],
  ['payments', plantPayments],
  ['surveys', plantSurveys],
  ['badges', plantBadges],
  ['automations', plantAutomations],
  ['campaigns', plantCampaigns],
  ['marketing', plantMarketing],
  ['registration', plantRegistration],
  ['donations', plantDonations],
  ['engagement', plantEngagement],
  // Batch 3j merge: networking and chat, cards on file, pledges and matches, the call for papers
  // and the guest gallery.
  ['networking', plantNetworking],
  ['donations-collection', plantDonationsCollection],
  ['cfp', plantCfp],
  ['gallery', plantGallery],
  // Batch 3k merge: an exhibitor's lead (M5.6b).
  ['leads', plantLeads],
];

/** Plant the person in every module of one org; returns the tables written. */
export async function plantPerson(
  p: Omit<PlantCtx, 'ids'>,
): Promise<{ tables: Set<string>; ids: Record<string, string> }> {
  const ids: Record<string, string> = {};
  const tables = new Set<string>();
  for (const [name, plant] of PLANTERS) {
    try {
      for (const t of await plant({ ...p, ids })) tables.add(t);
    } catch (err) {
      throw new Error(`planter ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The outbox log too: an event that names the person (projections and webhooks read these).
  await p.admin`
    insert into platform.domain_events (org_id, type, version, aggregate_type, aggregate_id, payload, actor, request_id)
    values (${p.orgId}, 'crm.contact_noted', 1, 'contact', ${ids.contactId ?? 'x'},
      ${p.admin.json({ email: p.person.email, name: p.person.name, phone: p.person.phone, nested: [{ to: p.person.email }] })},
      'system:dsar-test', 'dsar-test')`;
  tables.add('platform.domain_events');
  return { tables, ids };
}
