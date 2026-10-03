/**
 * Browser-safe seating logic (no database): the same rule evaluation and live-state helpers the
 * server uses, for pages that warn as seats are chosen and apply live availability.
 */

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
// M4.3b cards and exports: card kinds, paper sizes and sheet layouts for the print page.
export {
  CARD_KINDS,
  type CardKind,
  EXPORT_FORMATS,
  EXPORT_KINDS,
  type ExportFormat,
  type ExportKind,
  PAPER_SIZES,
  type PaperSize,
  sheetLayout,
} from './domain/cards.ts';
