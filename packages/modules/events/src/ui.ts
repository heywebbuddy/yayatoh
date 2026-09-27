/** Client-safe exports (no database code): constants and pure helpers for forms and rendering. */
export {
  ATTENDANCE_MODES,
  type AttendanceMode,
  EVENT_CATEGORIES,
  type EventCategory,
  MAX_TAGS_PER_EVENT,
} from './domain/categories.ts';
export { ANNOUNCEMENT_AUDIENCES, SECTION_KINDS, type SectionKind } from './domain/content-kinds.ts';
export { type MdBlock, type MdInline, parseMarkdown } from './domain/markdown.ts';
export { vanityProblem } from './domain/short-code.ts';
