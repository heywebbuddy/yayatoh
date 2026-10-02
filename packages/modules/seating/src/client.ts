/**
 * Browser-safe seating logic (no database): the same rule evaluation and live-state helpers the
 * server uses, for pages that warn as seats are chosen and apply live availability.
 */
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
