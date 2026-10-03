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
  adaReleaseAt,
  blockingHits,
  evaluateSeatRules,
  type RuleContext,
  type RuleHit,
  type RuleSeverity,
  type SeatingRule,
} from './domain/rules.ts';
// M4.3a guest seating: fit, VIP zones and the queue, the same in the editor and the commands.
export {
  declinedSeated,
  type FitResult,
  fitAt,
  freeSeats,
  OCCUPANT_STATUSES,
  type OccupantStatus,
  type PlaceLike,
  type QueueGuest,
  type SeatedLike,
  unseatedOf,
  VIP_WARNINGS,
  type VipWarning,
  vipWarning,
} from './domain/guest-seating.ts';
