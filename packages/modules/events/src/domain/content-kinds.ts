export const SECTION_KINDS = ['text', 'faq', 'schedule', 'location', 'links'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const ANNOUNCEMENT_AUDIENCES = ['public', 'holders'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const SHORT_LINK_KINDS = ['auto', 'vanity'] as const;
export type ShortLinkKind = (typeof SHORT_LINK_KINDS)[number];
