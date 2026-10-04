import { createHash } from 'node:crypto';

/**
 * M6.10a: identities for Zoom attendance, all sha256 (64 hex digits): never an address in clear.
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** One stay in a webinar: the participant's address and the second they joined. */
export const zoomSegmentKey = (email: string, joinedAt: Date) =>
  sha(`segment|${email.trim().toLowerCase()}|${Math.floor(joinedAt.getTime() / 1000)}`);

/** A participant across their joins and leaves: Zoom's participant id, else their address. */
export const zoomParticipantKey = (webinarId: string, participant: string) =>
  sha(`participant|${webinarId}|${participant.trim().toLowerCase()}`);

/** A webhook's deduplication key from the provider's event identity. */
export const zoomEventKey = (providerEventId: string) => sha(`event|${providerEventId}`);
