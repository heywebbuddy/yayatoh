/** Browser-safe badge logic (the designer's live preview): no database, no Node APIs. */
export { elementText, type ResolvedElement, resolveBadge } from './domain/content.ts';
export {
  BadgeDesign,
  type BadgeDesignInput,
  BadgeElement,
  type BadgeElementInput,
  defaultDesign,
  ELEMENT_KINDS,
  type ElementKind,
  MAX_ELEMENTS_PER_FACE,
  MAX_FONT_PT,
  MIN_FONT_PT,
  PERSON_KINDS,
  RIBBON_COLOR_KEYS,
  RIBBON_COLORS,
  Ribbon,
  type RibbonColor,
  TEXT_KINDS,
} from './domain/design.ts';
export {
  type Box,
  clampBox,
  faceOrigin,
  layoutWarnings,
  moveBox,
  outsideSafeArea,
  placeElement,
  rescaleDesign,
  resizeBox,
} from './domain/layout.ts';
export { splitName, surnameSortKey } from './domain/names.ts';
export {
  comesOnline,
  goesQuiet,
  MAX_PRINT_NOTE,
  MAX_PRINTERS_PER_EVENT,
  offlineAt,
  PRINT_JOB_STATUSES,
  PRINT_KINDS,
  PRINT_PDF_TTL_MS,
  PRINT_REASONS,
  PRINT_SOURCES,
  PRINTER_ADAPTERS,
  PRINTER_OFFLINE_AFTER_MS,
  PRINTER_STATUSES,
  type PrinterAdapter,
  type PrinterPulse,
  type PrinterStatus,
  type PrintJobStatus,
  type PrintKind,
  type PrintReason,
  type PrintSource,
  printKindFor,
  REPRINT_REASONS,
  type ReasonProblem,
  type ReprintReason,
  reasonProblem,
  STATION_HEARTBEAT_MS,
} from './domain/printing.ts';
export { pruneRibbons, ribbonFor } from './domain/ribbons.ts';
export { BadgeRow, type BadgeSource, badgeRow, companyOf, placedKinds } from './domain/row.ts';
export { SAMPLE_CODE, sampleRows } from './domain/samples.ts';
export {
  BADGE_SIZES,
  type BadgeSize,
  facesOf,
  isBadgeSize,
  mmToPt,
  PT_PER_MM,
  pageSizeMm,
  ptToMm,
  SIZES,
  type SizeSpec,
} from './domain/sizes.ts';
export { BATCH_SORTS, type BatchSort, type SortableBadge, sortBadges } from './domain/sort.ts';
export { charWidthEm, fitFontSize, textWidthMm } from './domain/text.ts';
