import 'server-only';

/** The locale-neutral address of the app (the phone's own language decides the page's). */
export function appOrigin(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_ORIGIN ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/** A party's RSVP link, and the paper fallback's address. */
export const rsvpUrl = (token: string) => `${appOrigin()}/rsvp/${encodeURIComponent(token)}`;
/** M4.4a: a party's seat page (the same signed link; permanent as the party moves). */
export const partySeatUrl = (token: string) => `${appOrigin()}/rsvp/${encodeURIComponent(token)}/seat`;
export const rsvpFindUrl = (code: string) => `${appOrigin()}/rsvp/find/${code}`;

/** An event's public contact collector (M4.1f). */
export const collectUrl = (code: string) => `${appOrigin()}/collect/${code}`;
