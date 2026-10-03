export { unseatedAttendeesTx } from './alert-facts.ts';
export {
  assignSeatsCommand,
  MAX_ASSIGN,
  releaseAttendeeSeatsTx,
  releaseCancelledSeats,
  SeatAssignmentsDto,
  seatAssignmentsQuery,
  seatFillTx,
  seatsOccupiedTx,
  unassignSeatsCommand,
} from './assignments.ts';
// M6.11a: best available and the ADA engine (companion seats).
export {
  adoptSeatHoldTx,
  BEST_AVAILABLE_HOLD_MINUTES,
  BestAvailableHoldDto,
  companionSeatsTx,
  companionSuggestions,
  HeldSeatDto,
  holdBestAvailableCommand,
  holdBestAvailableStaffCommand,
  holdBestAvailableTx,
  holdIdForToken,
  MAX_BEST_AVAILABLE,
  MAX_COMPANION_SEATS,
  MAX_SECTION_SCORE,
  releaseBestAvailableCommand,
  SelectionPageDto,
  SelectionSettingsDto,
  selectionPageQuery,
  selectionSettingsTx,
  setCompanionSeatsCommand,
  setSelectionSettingsCommand,
} from './best-available.ts';
export { BulkAssignTarget, seatAssignAction, seatAssignBulk } from './bulk-assign.ts';
// M4.3b cards and exports: place, escort and table cards (PDF), the seating chart and meal counts.
export {
  ExportGuestSeatingInput,
  exportGuestSeatingCommand,
  GuestSeatingExportDto,
  MealCountsDto,
  SeatingCardsDto,
  SeatingSheetDto,
  seatingCardsQuery,
} from './cards.ts';
export { type CardsCopy, type CardsHtmlInput, cardsHtml } from './cards-document.ts';
// M6.11b: sales channels and allotments, layout revisions, the venue layout library.
export {
  allotSeatsCommand,
  assertSeatChannelsTx,
  ChannelDto,
  ChannelsPageDto,
  channelKeptSeatsTx,
  deleteSeatChannelCommand,
  MAX_ALLOT_SEATS,
  MAX_CHANNELS,
  orderChannelTx,
  recordChannelOrderTx,
  resolveSaleChannelTx,
  saveSeatChannelCommand,
  seatChannelsQuery,
} from './channels.ts';
export { type ChartKey, publicDoc } from './chart.ts';
export { instantiateSeatingTx, SeatingSnapshot, seatingSnapshotTx } from './copy.ts';
export { seatingDataSubjects } from './data-subject.ts';
export {
  ASSIGN_SEAT_STATES,
  type AssignSeatState,
  assignSeatState,
  pickSeats,
} from './domain/assign.ts';
export {
  type BestAvailableFailure,
  type BestAvailablePick,
  type BestAvailableRequest,
  bestAvailable,
  isTogether,
  type PlanSeat,
} from './domain/best-available.ts';
export {
  BULK_ASSIGN_FAILURES,
  BULK_ASSIGN_WARNINGS,
  BULK_TARGET_KINDS,
  type BulkAssignFailure,
  type BulkAssignUndo,
  type BulkTargetKind,
  planChunk,
  planUndo,
} from './domain/bulk-assign.ts';
export {
  CARD_KINDS,
  type CardKind,
  type CardsOf,
  cardSizeMm,
  cardsOf,
  defaultPaper,
  type EscortCard,
  EXPORT_FORMATS,
  EXPORT_KINDS,
  type ExportCell,
  type ExportCopy,
  type ExportFormat,
  type ExportKind,
  escortCards,
  isCardKind,
  isExportFormat,
  isExportKind,
  isPaperSize,
  isTent,
  type MealCountRow,
  type MealCounts,
  mealCounts,
  mealCountsTable,
  nameSheet,
  PAPER,
  PAPER_SIZES,
  type PaperSize,
  type PlaceCard,
  paginate,
  placeCards,
  type SeatingSheet,
  type SeatingViewLike,
  SHEET_MARGIN_MM,
  type SheetGuest,
  type SheetLayout,
  type SheetPlace,
  seatingChartTable,
  seatingSheet,
  sheetLayout,
  type TableCard,
  tableCards,
} from './domain/cards.ts';
export {
  type ChannelRef,
  channelHolds,
  normalizeChannelCode,
  SALE_VIAS,
  type SaleVia,
  saleChannel,
  seatNumberList,
  sellableThrough,
} from './domain/channels.ts';
// M4.4a guest seat finder: the party's page (link), PIN mode and the `PartyCredentials` port.
export { type FinderGuest, type FinderParty, partyOnChart } from './domain/guest-finder.ts';
// M4.3a guest seating: parties and guests at tables (the OccupantDirectory port, guests side).
export {
  declinedSeated,
  fitAt,
  freeSeats,
  OCCUPANT_STATUSES,
  type OccupantStatus,
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
  diffDocs,
  type InUseSeat,
  type LayoutDiff,
  planRestore,
  RESTORE_CONFLICTS,
  type RestoreConflict,
  type RestoreOutcome,
  type RestorePlan,
} from './domain/revisions.ts';
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
export {
  fromStatuses,
  nextSeatStatus,
  SEAT_EVENTS,
  SEAT_STATUSES,
  type SeatEvent,
  type SeatStatus,
} from './domain/seat-state.ts';
export {
  allocateGroupSeatsCommand,
  MAX_GROUP_SEATS,
  releaseGroupSeatsCommand,
  SeatGroupDto,
  seatGroupsQuery,
} from './groups.ts';
// M4.4b: every guest's tables for the day of (check-in, kiosk, A–Z board, host view).
export { type GuestPlace, type GuestPlaces, guestPlacesTx } from './guest-day-of.ts';
export {
  findGuestSeatByPinCommand,
  GuestSeatResultDto,
  PARTY_SEATS_STATES,
  type PartyCredentials,
  PartySeatsDto,
  PIN_LOOKUP_STATUSES,
  partySeatsQuery,
  setPartyCredentials,
} from './guest-finder.ts';
export {
  GUEST_SEATS_CHANNEL,
  GuestSeatDto,
  GuestSeatingDto,
  guestSeatingQuery,
  guestSeatingViewTx,
  MAX_GUESTS_PER_SEATING,
  type Occupant,
  type OccupantDirectory,
  type OccupantParty,
  type OccupantSubEvent,
  PLACE_KINDS,
  SeatGuestsInput,
  SeatGuestsResult,
  SeatingPartyDto,
  SeatingPlaceDto,
  seatGuestsCommand,
  setOccupantDirectory,
  setVipTableCommand,
  unseatGuestsCommand,
} from './guest-seating.ts';
export {
  extendSeatHoldTx,
  heldSeatsTx,
  holdSeatsTx,
  releaseExpiredSeatHoldsTx,
  releaseSeatHoldTx,
  seatedTicketTypesTx,
  sellSeatsTx,
  voidSeatTx,
} from './holds.ts';
export {
  assignSeatCategoryCommand,
  blockSeatsCommand,
  copySeat,
  DateChartDto,
  dateChartsQuery,
  EventSeatingDto,
  eventSeatingQuery,
  getLayoutQuery,
  giveDateOwnChartCommand,
  LayoutSummaryDto,
  listLayoutsQuery,
  PublicSeatMapDto,
  publicSeatMap,
  publicUnderlayShown,
  publishEventLayoutCommand,
  removeDateChartCommand,
  saveLayoutCommand,
  setEventLayoutCommand,
} from './layouts.ts';
export {
  deleteLayoutCommand,
  LibraryLayoutDto,
  layoutLibraryQuery,
  renameLayoutCommand,
} from './library.ts';
export {
  chartForDate,
  createSeatFeed,
  listenForSeatChanges,
  loadSeatSnapshot,
  PublicSeatsData,
  SEAT_NOTIFY_CHANNEL,
  SEAT_STATES_CHANNEL,
  SEATS_CHANNEL,
  type SeatFeed,
  type SeatFeedOptions,
  type SeatSnapshot,
  type SeatStreamKind,
  type SeatWatch,
  StaffSeatsData,
  seatChannels,
  seatingLiveAccessQuery,
} from './live.ts';
export { seatedAttendeeIdsTx } from './participation.ts';
// M4.7a: the seats of a party for its guest hub (the app passes this reader to the guests module).
export { partySeatsTx } from './party-seats.ts';
export { privateColumns } from './private-columns.ts';
export {
  DIFF_LIST_LIMIT,
  KEEP_REVISIONS,
  layoutRevisionQuery,
  layoutRevisionsQuery,
  RevisionDetailDto,
  RevisionSummaryDto,
  RevisionsPageDto,
  restoreLayoutRevisionCommand,
} from './revisions.ts';
export {
  checkSeatRulesTx,
  MAX_COMPANIONS_PER_ACCESSIBLE,
  MAX_RELEASE_DAYS,
  MAX_SEATS_PER_ORDER,
  RuleHitDto,
  SeatingRuleDto,
  seatingRulesQuery,
  seatingRulesTx,
  setSeatingRulesCommand,
} from './rules.ts';
export {
  BLOCK_REASONS,
  CHANNEL_CODE,
  CHANNEL_KINDS,
  CODE_CHANNEL_KINDS,
  EVENT_LAYOUT_STATUSES,
  FINDER_MODES,
  MAX_GROUP_LABEL,
  REVISION_KINDS,
  RULE_SEVERITIES,
  SEAT_BLOCK_REASONS,
  SEATING_RULE_KINDS,
} from './schema.ts';
export {
  devFinderCode,
  FINDER_CODE_TTL_MS,
  FINDER_CODES_PER_HOUR,
  FINDER_MAX_ATTEMPTS,
  FINDER_RATE_LIMIT,
  FINDER_RATE_WINDOW_MS,
  FINDER_VERIFY_STATUSES,
  FINDER_VIEW_MS,
  FinderPosterDto,
  FinderSettingsDto,
  finderCodeMailer,
  finderPosterQuery,
  finderResultQuery,
  finderSettingsQuery,
  findSeatByNameCommand,
  PublicVenueMapDto,
  publicVenueMapQuery,
  requestFinderCodeCommand,
  SeatFinderResultDto,
  setFinderSettingsCommand,
  verifyFinderCodeCommand,
} from './seat-finder.ts';
export {
  attendeeSeatLabelsQuery,
  attendeeSeatLabelsTx,
  SeatPerson,
  seatLabelWithSection,
  ticketSeatLabelsQuery,
} from './seat-labels.ts';
// M4.1c: a wedding sub-event's own chart, falling back to its date's chart, then the event plan.
export {
  giveSubEventOwnChartCommand,
  removeSubEventChartCommand,
  resolveSubEventChartTx,
  SUB_EVENT_CHART_SOURCES,
  SubEventChartDto,
  type SubEventChartSource,
  type SubEventRef,
  subEventChartsQuery,
} from './sub-event-charts.ts';
// M4.2b hosted tables: sponsors on the plan's tables.
export {
  PlanTableDto,
  PublicTableSponsorDto,
  planTablesQuery,
  removeTableSponsorCommand,
  SetTableSponsorInput,
  setTableSponsorCommand,
  TableSponsorDto,
} from './table-sponsors.ts';
// M6.14b venue portal: shared plans (copy-on-use) and the venue's view of their use.
export {
  SharedLayoutDto,
  sharedLayoutsQuery,
  sharedLayoutUsesTx,
  shareLayoutCommand,
  unshareLayoutCommand,
  useSharedLayoutCommand,
  VenueLayoutUseDto,
  VenuePortalDto,
  VenuePortalLayoutDto,
  venuePortalQuery,
} from './venue-sharing.ts';
