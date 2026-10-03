import { alertsDataSubjects } from '@yayatoh/alerts';
import { assistanceDataSubjects } from '@yayatoh/assistance';
import { attendeesDataSubjects } from '@yayatoh/attendees';
import { automationsDataSubjects } from '@yayatoh/automations';
import { badgesDataSubjects } from '@yayatoh/badges';
import { campaignsDataSubjects } from '@yayatoh/campaigns';
import { checkinDataSubjects } from '@yayatoh/checkin';
import { cmsDataSubjects } from '@yayatoh/cms';
import { crmDataSubjects } from '@yayatoh/crm';
import { donationsDataSubjects } from '@yayatoh/donations';
import { engagementDataSubjects } from '@yayatoh/engagement';
import { eventsDataSubjects } from '@yayatoh/events';
import { formsDataSubjects } from '@yayatoh/forms';
import { galleryDataSubjects } from '@yayatoh/gallery';
import { guestsDataSubjects } from '@yayatoh/guests';
import { marketingDataSubjects } from '@yayatoh/marketing';
import { mediaDataSubjects } from '@yayatoh/media';
import { messagingDataSubjects } from '@yayatoh/messaging';
import { notificationsDataSubjects } from '@yayatoh/notifications';
import { ordersDataSubjects } from '@yayatoh/orders';
import { paymentsDataSubjects } from '@yayatoh/payments';
import { platformDataSubjects } from '@yayatoh/platform';
import { privacyDataSubjects } from '@yayatoh/privacy';
import { programDataSubjects } from '@yayatoh/program';
import { registrationDataSubjects } from '@yayatoh/registration';
import { reviewsDataSubjects } from '@yayatoh/reviews';
import { seatingDataSubjects } from '@yayatoh/seating';
import { surveysDataSubjects } from '@yayatoh/surveys';
import { tenancyDataSubjects } from '@yayatoh/tenancy';
import { ticketingDataSubjects } from '@yayatoh/ticketing';
import { venuesDataSubjects } from '@yayatoh/venues';
import { virtualDataSubjects } from '@yayatoh/virtual';

/**
 * Every module's data-subject contributor (M6.1c), in the order erasure runs them (resolving
 * repeats until no module finds anything new, so order does not matter there). The platform's own
 * records go last: it redacts what the others leave in exports and the outbox. The coverage test
 * fails when a table with a personal or holder column has no contributor here.
 */
export const DATA_SUBJECT_CONTRIBUTORS = [
  crmDataSubjects,
  ordersDataSubjects,
  ticketingDataSubjects,
  attendeesDataSubjects,
  formsDataSubjects,
  checkinDataSubjects,
  tenancyDataSubjects,
  notificationsDataSubjects,
  seatingDataSubjects,
  alertsDataSubjects,
  guestsDataSubjects,
  messagingDataSubjects,
  assistanceDataSubjects,
  programDataSubjects,
  eventsDataSubjects,
  mediaDataSubjects,
  cmsDataSubjects,
  venuesDataSubjects,
  virtualDataSubjects,
  reviewsDataSubjects,
  paymentsDataSubjects,
  surveysDataSubjects,
  registrationDataSubjects,
  donationsDataSubjects,
  engagementDataSubjects,
  galleryDataSubjects,
  badgesDataSubjects,
  automationsDataSubjects,
  campaignsDataSubjects,
  marketingDataSubjects,
  privacyDataSubjects,
  platformDataSubjects,
] as const;
