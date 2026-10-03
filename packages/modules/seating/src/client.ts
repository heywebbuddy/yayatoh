/**
 * Browser-safe seating logic (no database): the same rule evaluation and live-state helpers the
 * server uses, for pages that warn as seats are chosen and apply live availability.
 */

// M6.11b: sales channels (the organizer's forms and the public map use the same rules).
export {
  CHANNEL_KINDS,
  CODE_CHANNEL_KINDS,
  channelHolds,
  normalizeChannelCode,
  seatNumberList,
  sellableThrough,
} from './domain/channels.ts';
export {
  availabilityLists,
  coalesceAvailability,
  LIVE_SEAT_STATES,
  type LiveSeatState,
  liveSeatState,
  type SeatCounts,
  seatCounts,
} from './domain/live.ts';
export {
  activeAdaRule,
  activeCompanionRule,
  adaReleaseAt,
  blockingHits,
  evaluateSeatRules,
  type RuleContext,
  type RuleHit,
  type RuleSeverity,
  type SeatingRule,
} from './domain/rules.ts';
