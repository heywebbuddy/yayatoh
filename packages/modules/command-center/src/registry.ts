import {
  assistanceSlotWidget,
  capacityWidget,
  checkinSpeedWidget,
  liveFeedWidget,
  scanIssuesWidget,
  staffPresenceWidget,
} from './live-widgets.ts';
import {
  alertsSlotWidget,
  checkinsWidget,
  createWidgetRegistry,
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
 * feed entries, member names for staff presence, M3.3b's assistance queue).
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
  assistanceSlotWidget,
]);
