import { defineSubscriber } from '@yayatoh/platform';
import { z } from 'zod';
import type { MappedSignal } from './fraud-rules.ts';
import { raiseFromSourceTx } from './fraud-sources.ts';

/**
 * M5.8b: networking chat reports become fraud signals (the M1.9e model, source `chat`, kind
 * `chat_abuse`) about the reported attendee's contact at the event. A report about an exhibitor's
 * booth raises nothing here (the organizer handles it; it is not about a buyer). The payload holds
 * ids and the reason only, never the details or any text.
 */
const NETWORK_REASONS = ['spam', 'harassment', 'inappropriate', 'fake', 'other'] as const;
type NetworkReason = (typeof NETWORK_REASONS)[number];

const ChatReported = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  reportId: z.uuid(),
  contactId: z.uuid().nullable(),
  reason: z.enum(NETWORK_REASONS),
});

/** Severity and the M1.9e reason vocabulary (spam, abuse, other) of a networking report. */
export function networkChatSignal(
  reason: NetworkReason,
): MappedSignal & { reason: 'spam' | 'abuse' | 'other' } {
  switch (reason) {
    case 'harassment':
    case 'inappropriate':
      return { kind: 'chat_abuse', severity: 'high', reason: 'abuse' };
    case 'spam':
      return { kind: 'chat_abuse', severity: 'medium', reason: 'spam' };
    case 'fake':
      return { kind: 'chat_abuse', severity: 'medium', reason: 'other' };
    default:
      return { kind: 'chat_abuse', severity: 'low', reason: 'other' };
  }
}

export function networkChatSignals() {
  const name = 'checkin.network-chat-signals';
  return defineSubscriber({
    name,
    events: ['engagement.chat_reported@1'],
    handle: async (tx, event) => {
      const p = ChatReported.parse(event.payload);
      if (!p.contactId) return;
      const { reason, ...mapped } = networkChatSignal(p.reason);
      await raiseFromSourceTx(tx, name, {
        ...mapped,
        orgId: p.orgId,
        source: 'chat',
        sourceEventId: event.id,
        eventId: p.eventId,
        contactId: p.contactId,
        detail: { reason },
      });
    },
  });
}
