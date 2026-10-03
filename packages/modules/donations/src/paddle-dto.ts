import { defineRealtimeChannel } from '@yayatoh/platform';
import { z } from 'zod';
import {
  BULK_SCOPES,
  CALL_STATUSES,
  ENTRY_REFUSALS,
  ENTRY_STATUSES,
  MAX_SYNC_BATCH,
  PADDLE_HOLDER_KINDS,
  PADDLE_MAX,
  PADDLE_MIN,
} from './domain/paddles.ts';

/** Allowlisted shapes of the paddle raise (M4.8c). Names reach organizer views only (P4-13). */
const PaddleNumber = z.int().min(PADDLE_MIN).max(PADDLE_MAX);

export const AssignPaddleInput = z
  .object({
    eventId: z.uuid(),
    guestId: z.uuid().nullish(),
    partyId: z.uuid().nullish(),
    /** Empty: the next free number. */
    number: PaddleNumber.nullish(),
  })
  .refine((v) => !!v.guestId !== !!v.partyId, { message: 'Choose a guest or a party', path: ['holder'] });

export const BulkAssignInput = z.object({
  eventId: z.uuid(),
  scope: z.enum(BULK_SCOPES),
  per: z.enum(PADDLE_HOLDER_KINDS),
  startAt: PaddleNumber.nullish(),
});

export const PaddleDto = z.object({
  id: z.uuid(),
  number: z.int(),
  holderKind: z.enum(PADDLE_HOLDER_KINDS),
  holderName: z.string(),
  /** The party (household, company or table) of a guest's paddle, or the party itself. */
  partyName: z.string().nullable(),
  /** Entries recorded with this paddle (any call), voided ones aside. */
  entries: z.int(),
});
export type PaddleDto = z.infer<typeof PaddleDto>;

export const PaddlesViewDto = z.object({
  paddles: z.array(PaddleDto),
  /** Named guests and parties without a paddle (for the assign-one form). */
  guestsWithout: z.array(z.object({ id: z.uuid(), name: z.string(), partyName: z.string() })),
  partiesWithout: z.array(z.object({ id: z.uuid(), name: z.string(), isTable: z.boolean() })),
  tableCount: z.int(),
  nextNumber: z.int().nullable(),
});
export type PaddlesViewDto = z.infer<typeof PaddlesViewDto>;

export const CallDto = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  levelName: z.string(),
  amountMinor: z.int(),
  currency: z.string(),
  status: z.enum(CALL_STATUSES),
  /** ISO 8601 (the live channels carry JSON). */
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  /** Counted paddles (recorded + confirmed) and their total; duplicates to check; pledges made. */
  count: z.int(),
  totalMinor: z.int(),
  duplicates: z.int(),
  confirmed: z.int(),
});
export type CallDto = z.infer<typeof CallDto>;

export const RaiseTotalsDto = z.object({
  /** Counted paddles over every call, and the sum of their levels. */
  count: z.int(),
  totalMinor: z.int(),
  /** Confirmed pledges (not cancelled). */
  pledgedMinor: z.int(),
  pledgeCount: z.int(),
  /** Entries waiting for the recorder: recorded but not confirmed, and duplicates. */
  toReview: z.int(),
  duplicates: z.int(),
  currency: z.string(),
});
export type RaiseTotalsDto = z.infer<typeof RaiseTotalsDto>;

/** What the console's live channel carries: the open call and the totals (snapshot and updates). */
export const ConsoleLiveDto = z.object({ open: CallDto.nullable(), totals: RaiseTotalsDto });
export type ConsoleLiveDto = z.infer<typeof ConsoleLiveDto>;

export const PaddleConsoleDto = ConsoleLiveDto.extend({
  campaigns: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      currency: z.string(),
      levels: z.array(z.object({ id: z.uuid(), name: z.string(), amountMinor: z.int() })),
    }),
  ),
  /** Every call, newest first (withdrawn ones aside). */
  calls: z.array(CallDto),
  paddleCount: z.int(),
});
export type PaddleConsoleDto = z.infer<typeof PaddleConsoleDto>;

/**
 * What a spotter's phone gets (P4-13): the level being called and the event's paddle numbers, so a
 * typed number is checked on the device even offline. Never names, never what anyone gave before.
 */
export const SpotterStateDto = z.object({
  call: z
    .object({ id: z.uuid(), levelName: z.string(), amountMinor: z.int(), currency: z.string() })
    .nullable(),
  paddles: z.array(z.int()),
});
export type SpotterStateDto = z.infer<typeof SpotterStateDto>;

export const RecordPaddlesInput = z.object({
  eventId: z.uuid(),
  entries: z
    .array(
      z.object({
        clientId: z.uuid(),
        callId: z.uuid(),
        paddle: PaddleNumber,
        recordedAt: z.coerce.date(),
      }),
    )
    .min(1)
    .max(MAX_SYNC_BATCH),
});

export const EntryOutcomeDto = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['recorded', 'duplicate', 'confirmed', 'voided']) }),
  z.object({ status: z.literal('refused'), reason: z.enum(ENTRY_REFUSALS) }),
]);

export const RecordPaddlesOutput = z.object({
  results: z.array(z.object({ clientId: z.uuid(), outcome: EntryOutcomeDto })),
});
export type RecordPaddlesOutput = z.infer<typeof RecordPaddlesOutput>;

export const ReviewEntryDto = z.object({
  id: z.uuid(),
  paddleNumber: z.int(),
  /** The holder's name (organizer only), or null when the paddle has gone since. */
  holderName: z.string().nullable(),
  status: z.enum(ENTRY_STATUSES),
  /** For a duplicate: the paddle number's first entry at this call. */
  duplicateOf: z.uuid().nullable(),
  recordedAt: z.date(),
  receivedAt: z.date(),
});
export type ReviewEntryDto = z.infer<typeof ReviewEntryDto>;

export const PaddleReviewDto = z.object({
  calls: z.array(z.object({ call: CallDto, entries: z.array(ReviewEntryDto) })),
  totals: RaiseTotalsDto,
});
export type PaddleReviewDto = z.infer<typeof PaddleReviewDto>;

/** The spotters' channel: anyone who may record paddles at the event (`checkin:scan`). */
export const SPOTTER_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'paddle-spotters',
  source: 'log',
  description: 'The level being called and the paddle numbers of a paddle raise (spotters)',
  entitlement: 'donations',
  access: { permission: 'checkin:scan' },
  snapshot: SpotterStateDto,
  events: { state: SpotterStateDto },
});

/** The console's channel: the open call and the running totals (`orders:read`). */
export const PADDLE_CONSOLE_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'paddle-console',
  source: 'log',
  description: 'The running totals of a paddle raise (host console and recorder)',
  entitlement: 'donations',
  access: { permission: 'orders:read' },
  snapshot: ConsoleLiveDto,
  events: { state: ConsoleLiveDto },
});

export const PADDLE_REALTIME_CHANNELS = [SPOTTER_CHANNEL, PADDLE_CONSOLE_CHANNEL] as const;
