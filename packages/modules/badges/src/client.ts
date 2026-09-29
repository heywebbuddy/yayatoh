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
