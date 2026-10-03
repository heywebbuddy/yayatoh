import { defineRealtimeChannel } from '@yayatoh/platform';
import { z } from 'zod';
import {
  ModPollDto,
  ModQuestionDto,
  ModStateDto,
  PublicLiveStateDto,
  PublicPollDto,
  PublicQuestionDto,
  StageDto,
} from './dto.ts';

/**
 * The live channels of one session (M5.7a, over the M3.1b publisher). Every message is the full
 * allowlisted shape of what changed, so a screen applies it as is; a (re)connecting screen gets the
 * whole state as its snapshot, or is replayed what it missed by id.
 */
const Removed = z.object({ id: z.uuid() });

/**
 * The audience's channel: anyone may attach to a public event's live session (and the session's
 * signed big-screen link). Approved questions and shown results only.
 */
export const LIVE_CHANNEL = defineRealtimeChannel({
  scope: 'session',
  topic: 'live',
  source: 'log',
  description: 'Polls and approved questions of one session (audience and big screen)',
  entitlement: 'sessions',
  access: { public: true, permission: 'events:read' },
  snapshot: PublicLiveStateDto,
  events: {
    poll: PublicPollDto,
    'poll-removed': Removed,
    question: PublicQuestionDto,
    'question-removed': Removed,
    stage: StageDto,
  },
});

/** The moderators' channel: the whole queue (pending questions included) and live results. */
export const MODERATION_CHANNEL = defineRealtimeChannel({
  scope: 'session',
  topic: 'moderation',
  source: 'log',
  description: 'The Q&A queue and poll results of one session (members)',
  entitlement: 'sessions',
  access: { permission: 'events:read' },
  snapshot: ModStateDto,
  events: {
    poll: ModPollDto,
    'poll-removed': Removed,
    question: ModQuestionDto,
    stage: StageDto,
  },
});

export const ENGAGEMENT_REALTIME_CHANNELS = [LIVE_CHANNEL, MODERATION_CHANNEL] as const;
