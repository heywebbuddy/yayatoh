import type { TenantTx } from '@yayatoh/db';
import { isDomainError } from '@yayatoh/kernel';
import { linkPartyTx, matchPartyByNamePinTx } from './rsvp.ts';
import { partyOfTx } from './rsvp-state.ts';

/**
 * Seating's `PartyCredentials` port (M4.4a, guest seat finder), implemented here and registered in
 * each app's composition root (`setPartyCredentials`): seating is the same tier, so neither module
 * imports the other. The party's credentials are the M4.1d ones: its signed link (also its QR
 * code) and, for paper invitations, a guest's exact full name plus the party's PIN. Both answer in
 * the caller's transaction (the org comes from the link's SECURITY DEFINER lookup or the event).
 */
export const guestsPartyCredentials = {
  /**
   * The party of a link, or null for a bad, reset, foreign or expired link. `partyName` is the
   * name the host chose for it (the envelope name, else the party's name).
   */
  async partyByLinkTx(
    tx: TenantTx,
    token: string,
    now: Date,
  ): Promise<{ eventId: string; partyId: string; partyName: string } | null> {
    let row: Awaited<ReturnType<typeof linkPartyTx>>;
    try {
      row = await linkPartyTx(tx, token);
    } catch (err) {
      if (isDomainError(err) && err.code === 'not_found') return null;
      throw err;
    }
    if (row.linkExpiresAt.getTime() <= now.getTime()) return null;
    const party = await partyOfTx(tx, row.eventId, row.partyId);
    return { eventId: row.eventId, partyId: row.partyId, partyName: party.envelopeName ?? party.name };
  },

  /**
   * The party behind an exact full name and its PIN, or null; the same work for every miss
   * (`matchPartyByNamePinTx`). Unlike the RSVP fallback it is not refused when the host turned
   * RSVP name lookup off: the seat finder has its own switch (the organizer's finder mode).
   */
  async partyByNamePinTx(
    tx: TenantTx,
    eventId: string,
    name: string,
    pin: string,
  ): Promise<{ partyId: string } | null> {
    const match = await matchPartyByNamePinTx(tx, eventId, name, pin);
    return match && match.eventId === eventId ? { partyId: match.partyId } : null;
  },
};
