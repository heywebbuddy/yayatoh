import {
  exhibitorActivityWidget,
  sessionAttendanceWidget,
  sessionFillWidget,
  sponsorActivityWidget,
} from './conference-widgets.ts';
import {
  capacityWidget,
  checkinSpeedWidget,
  liveFeedWidget,
  scanIssuesWidget,
  staffPresenceWidget,
} from './live-widgets.ts';
import { arrivalsWidget, guestSeatingWidget, mealsWidget, rsvpWidget } from './social-widgets.ts';
import {
  alertsSlotWidget,
  assistanceWidget,
  campaignsWidget,
  checkinsWidget,
  createWidgetRegistry,
  deliverabilityWidget,
  deviceBoardWidget,
  devicesWidget,
  entrancesWidget,
  readinessWidget,
  salesWidget,
  seatFillWidget,
  ticketsWidget,
  timelineWidget,
  type WidgetRegistry,
} from './widgets.ts';

/**
 * The module's own registry: every widget with the loaders this module can build alone. The apps
 * replace the slots and the port-backed widgets with `withWidget` (the alert engine's alerts and
 * feed entries, member names for staff presence, M3.6b's campaign names for the campaigns tile,
 * M5.9a's leads and sponsor deliverables).
 * M3.3b's assistance queue loads here directly.
 */
export const COMMAND_CENTER_WIDGETS: WidgetRegistry = createWidgetRegistry([
  readinessWidget,
  salesWidget,
  ticketsWidget,
  checkinsWidget,
  seatFillWidget,
  devicesWidget,
  timelineWidget,
  alertsSlotWidget,
  entrancesWidget,
  deviceBoardWidget,
  liveFeedWidget(null),
  checkinSpeedWidget,
  scanIssuesWidget,
  capacityWidget,
  staffPresenceWidget(null),
  assistanceWidget,
  campaignsWidget(null),
  deliverabilityWidget,
  // M5.9a conference pack: leads and deliverables come through the app's ports (`withWidget`).
  sessionAttendanceWidget,
  sessionFillWidget,
  exhibitorActivityWidget(null),
  sponsorActivityWidget(null),

  // M4.6a social pack.
  rsvpWidget,
  guestSeatingWidget,
  mealsWidget,
  arrivalsWidget,
]);
