/**
 * Browser-safe seating logic (no database): the same rule evaluation and live-state helpers the
 * server uses, for pages that warn as seats are chosen and apply live availability.
 */

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
// M6.11b: sales channels (the organizer's forms and the public map use the same rules).
export {
  CHANNEL_KINDS,
  CODE_CHANNEL_KINDS,
  channelHolds,
  normalizeChannelCode,
  seatNumberList,
  sellableThrough,
} from './domain/channels.ts';
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
  activeCompanionRule,
  adaReleaseAt,
  blockingHits,
  evaluateSeatRules,
  type RuleContext,
  type RuleHit,
  type RuleSeverity,
  type SeatingRule,
} from './domain/rules.ts';
// M6.12a seating rules and solver: the rule builder's specs and the tabu search (Web Worker).
export {
  type Compiled,
  compile,
  createSearch,
  DEFAULT_SEARCH,
  defaultIterations,
  type Evaluation,
  evaluate,
  HARD_COST,
  MAX_SPLIT_COST,
  type Point,
  type Proposal,
  planGeometry,
  type RuleScore,
  type Search,
  type SearchOptions,
  SOLVER_ISSUES,
  type SolverGuest,
  type SolverIssue,
  type SolverIssueCode,
  type SolverPlace,
  type SolverProblem,
  seededRandom,
  solve,
  UNSEATED_COST,
  unitIndexOf,
  type Violation,
} from './domain/solver.ts';
export {
  DEFAULT_ACCESS_TAG,
  DEFAULT_RULE_WEIGHT,
  MAX_RULE_WEIGHT,
  MAX_SOLVER_RULES,
  MIN_RULE_WEIGHT,
  RuleTarget,
  SOLVER_RULE_KINDS,
  SOLVER_STRENGTHS,
  type SolverRule,
  type SolverRuleKind,
  SolverRuleShape,
  SolverRuleSpec,
  type SolverStrength,
  sameRule,
  sameTarget,
  TogetherGroup,
} from './domain/solver-rules.ts';
