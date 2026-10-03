import { z } from 'zod';
import { PersonRefDto } from '../networking/dto.ts';
import { CHAT_KINDS, CHAT_MODERATION_STATES, CHAT_REVIEW_STATES, REPORT_REASONS } from '../schema.ts';

/**
 * Allowlisted shapes of networking chat (M5.8b). An attendee sees the other person only as the
 * profile they chose to show (`PersonRefDto`) and an exhibitor by its public name and booths;
 * exhibitor staff see a visitor the same way. Never an email, contact, attendee, ticket, portal
 * account or user id. Organizers and Yayatoh staff see conversations only as a reported excerpt.
 */
export const ChatKindDto = z.enum(CHAT_KINDS);

/** Why a conversation can't take a new message now (the page says so instead of the box). */
export const ChatClosedDto = z.enum([
  /** The organizer switched chat off for the event. */
  'chat_off',
  /** Direct chat: no accepted connection or agreed meeting between the two. */
  'not_connected',
  /** Booth chat: the exhibitor doesn't take chats (off, suspended, unlisted or left its booth). */
  'booth_closed',
  /** Booth chat: one side blocked the other. */
  'blocked',
]);
export type ChatClosedDto = z.infer<typeof ChatClosedDto>;

/** One message as one side sees it. A removed message has no text. */
export const ChatMessageDto = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  fromMe: z.boolean(),
  removed: z.boolean(),
  at: z.date(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDto>;

/** An exhibitor as an attendee sees it in booth chat. */
export const BoothRefDto = z.object({
  id: z.uuid(),
  name: z.string(),
  boothNumbers: z.array(z.string()),
});
export type BoothRefDto = z.infer<typeof BoothRefDto>;

const LastMessageDto = z.object({ body: z.string().nullable(), fromMe: z.boolean(), at: z.date() });

/** One conversation in an attendee's chat list. */
export const ChatSummaryDto = z.object({
  id: z.uuid(),
  kind: ChatKindDto,
  /** Direct chat: the other person. */
  person: PersonRefDto.nullable(),
  /** Booth chat: the exhibitor. */
  booth: BoothRefDto.nullable(),
  last: LastMessageDto.nullable(),
  unread: z.int().min(0),
});
export type ChatSummaryDto = z.infer<typeof ChatSummaryDto>;

/** An attendee's chats, and the booths that take chats at the event. */
export const ChatInboxDto = z.object({
  chatEnabled: z.boolean(),
  conversations: z.array(ChatSummaryDto),
  booths: z.array(BoothRefDto),
});
export type ChatInboxDto = z.infer<typeof ChatInboxDto>;

/** One conversation as an attendee opens it (with a person or a booth). */
export const ChatThreadDto = z.object({
  /** Null until the first message is sent. */
  conversationId: z.uuid().nullable(),
  kind: ChatKindDto,
  person: PersonRefDto.nullable(),
  booth: BoothRefDto.nullable(),
  messages: z.array(ChatMessageDto),
  /** Null when a message may be sent now; else why not. */
  closed: ChatClosedDto.nullable(),
  /** Booth chat: this attendee blocked the booth (they may unblock it). */
  blockedByMe: z.boolean(),
});
export type ChatThreadDto = z.infer<typeof ChatThreadDto>;

/* -------------------------------------------------------------------- exhibitor side ---- */

/** A visitor of a booth chat as the exhibitor's people see them: the chosen profile basics. */
export const VisitorDto = z.object({
  displayName: z.string(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
});
export type VisitorDto = z.infer<typeof VisitorDto>;

export const BoothChatSummaryDto = z.object({
  id: z.uuid(),
  visitor: VisitorDto,
  last: LastMessageDto.nullable(),
  unread: z.int().min(0),
  blocked: z.boolean(),
});
export type BoothChatSummaryDto = z.infer<typeof BoothChatSummaryDto>;

export const BoothInboxDto = z.object({
  /** The organizer's switch for the event (networking and chat on). */
  eventChat: z.boolean(),
  /** The exhibitor's own switch, and whether the organizer suspended it. */
  enabled: z.boolean(),
  suspended: z.boolean(),
  /** The exhibitor stands at a booth and is listed (else attendees can't find it). */
  atBooth: z.boolean(),
  canManage: z.boolean(),
  conversations: z.array(BoothChatSummaryDto),
});
export type BoothInboxDto = z.infer<typeof BoothInboxDto>;

export const BoothThreadDto = z.object({
  id: z.uuid(),
  visitor: VisitorDto,
  messages: z.array(ChatMessageDto),
  closed: ChatClosedDto.nullable(),
  /** The booth blocked this visitor (it may unblock them). */
  blockedByMe: z.boolean(),
});
export type BoothThreadDto = z.infer<typeof BoothThreadDto>;

/* -------------------------------------------------------------------- organizer side ---- */

export const ChatExcerptDto = z.object({
  id: z.uuid(),
  /** The sender's display name (a person's profile name or the exhibitor's name). */
  from: z.string(),
  /** The reported side wrote it. */
  byReported: z.boolean(),
  body: z.string(),
  removed: z.boolean(),
  at: z.date(),
});
export type ChatExcerptDto = z.infer<typeof ChatExcerptDto>;

export const ChatReportDto = z.object({
  id: z.uuid(),
  kind: ChatKindDto,
  reason: z.enum(REPORT_REASONS),
  details: z.string().nullable(),
  moderation: z.enum(CHAT_MODERATION_STATES),
  createdAt: z.date(),
  reporterName: z.string(),
  reported: z.object({
    kind: z.enum(['person', 'exhibitor']),
    name: z.string(),
    /** The person is hidden, or the exhibitor's booth chat suspended. */
    actioned: z.boolean(),
  }),
  excerpt: z.array(ChatExcerptDto),
});
export type ChatReportDto = z.infer<typeof ChatReportDto>;

export const ChatConsoleDto = z.object({
  chatEnabled: z.boolean(),
  stats: z.object({
    conversations: z.int().min(0),
    messagesToday: z.int().min(0),
    openReports: z.int().min(0),
    boothsTakingChats: z.int().min(0),
  }),
  reports: z.array(ChatReportDto),
  suspendedBooths: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type ChatConsoleDto = z.infer<typeof ChatConsoleDto>;

/* ------------------------------------------------------------------ platform review ---- */

/**
 * A chat report as Yayatoh staff review it (M1.10d). The org's name and slug, the kind, which side
 * reported, the reason and details, the organizer's handling, and an excerpt labelled by side.
 * Never names, addresses or ids beyond the report's own.
 */
export const ChatReportForReviewDto = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  orgName: z.string(),
  orgSlug: z.string(),
  kind: ChatKindDto,
  reporter: z.enum(['attendee', 'exhibitor']),
  reason: z.enum(REPORT_REASONS),
  details: z.string().nullable(),
  moderation: z.enum(CHAT_MODERATION_STATES),
  status: z.enum(CHAT_REVIEW_STATES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  createdAt: z.date(),
  excerpt: z.array(
    z.object({
      from: z.enum(['reporter', 'reported']),
      text: z.string(),
      removed: z.boolean(),
      at: z.date(),
    }),
  ),
});
export type ChatReportForReviewDto = z.infer<typeof ChatReportForReviewDto>;

/* ------------------------------------------------------------------------- realtime ---- */

/** A message on the wire (an inbox channel): `at` as ISO text. */
export const ChatWireMessageDto = z.object({
  conversationId: z.uuid(),
  id: z.uuid(),
  body: z.string().nullable(),
  fromMe: z.boolean(),
  removed: z.boolean(),
  at: z.iso.datetime({ offset: true }),
});
export type ChatWireMessageDto = z.infer<typeof ChatWireMessageDto>;
