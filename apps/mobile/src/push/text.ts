import { scrubText } from '@yayatoh/mobile-core';

/**
 * Push text for the screen. The server already sends only the event name and what changed; this is
 * the second lock: an email address, a phone number, a token or a long code is replaced before it
 * can be drawn. Returns '' for nothing.
 */
export function scrubPushText(text: string | null | undefined): string {
  return text ? scrubText(text).trim() : '';
}
