/** Client-safe exports (no database code): constants and pure helpers for forms and rendering. */
export {
  ATTENDANCE_MODES,
  type AttendanceMode,
  EVENT_CATEGORIES,
  type EventCategory,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_EVENT,
  tagKey,
} from './domain/categories.ts';
export { ANNOUNCEMENT_AUDIENCES, SECTION_KINDS, type SectionKind } from './domain/content-kinds.ts';
export { type MdBlock, type MdInline, parseMarkdown } from './domain/markdown.ts';
export { isPlatformKey, MAX_CATEGORY_NAME } from './domain/org-categories.ts';
export type { SectionBody } from './domain/sections.ts';
export { vanityProblem } from './domain/short-code.ts';
export { parseVideoUrl, VIDEO_FRAME_ORIGINS, type VideoRef, videoEmbedUrl } from './domain/video.ts';
