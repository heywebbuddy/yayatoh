import { defineRealtimeChannel } from '@yayatoh/platform';
import { z } from 'zod';
import { ChatWireMessageDto } from './dto.ts';

/**
 * Chat inboxes (M5.8b, over the M3.1b publisher): one channel per attendee profile (`chat`) and
 * one per exhibitor (`booth-chat`, shared by its portal people) at an event. They are attached
 * only through the web app's own stream routes, which prove the caller owns the inbox (a verified
 * attendee address, a live exhibitor portal session); the generic `/api/realtime` attach refuses
 * them whatever the caller holds, so another org, another person or a member never attaches.
 * Messages carry what that inbox's owner may read: the text (null once removed) and which side
 * wrote it; the page re-reads on a snapshot.
 */
const Removed = z.object({ conversationId: z.uuid(), id: z.uuid() });

export const CHAT_CHANNEL = defineRealtimeChannel({
  scope: 'inbox',
  topic: 'chat',
  source: 'log',
  description: "An attendee's networking chats at one event",
  entitlement: 'sessions',
  access: { own: true },
  events: { message: ChatWireMessageDto, removed: Removed },
});

export const BOOTH_CHAT_CHANNEL = defineRealtimeChannel({
  scope: 'inbox',
  topic: 'booth-chat',
  source: 'log',
  description: "An exhibitor's booth chats at one event",
  entitlement: 'sessions',
  access: { own: true },
  events: { message: ChatWireMessageDto, removed: Removed },
});

export const CHAT_REALTIME_CHANNELS = [CHAT_CHANNEL, BOOTH_CHAT_CHANNEL] as const;
