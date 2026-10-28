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
export {
  DEFAULT_EVENT_DESIGN,
  EVENT_THEMES,
  EventDesign,
  HEADING_FONTS,
  HERO_LAYOUTS,
  parseEventDesign,
} from './domain/design.ts';
export { type MdBlock, type MdInline, parseMarkdown } from './domain/markdown.ts';
export { isPlatformKey, MAX_CATEGORY_NAME } from './domain/org-categories.ts';
export type { SectionBody } from './domain/sections.ts';
export { vanityProblem } from './domain/short-code.ts';
export {
  isUploadedPoster,
  isUploadedVideo,
  parseVideoUrl,
  UPLOADED_POSTER_PATH,
  UPLOADED_VIDEO_PATH,
  VIDEO_FRAME_ORIGINS,
  type VideoRef,
  videoEmbedUrl,
} from './domain/video.ts';
