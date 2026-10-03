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
/** A party's guest page (M4.7a): the same token as its RSVP link. */
export const hubUrl = (token: string) => `${appOrigin()}/hub/${encodeURIComponent(token)}`;
export const rsvpFindUrl = (code: string) => `${appOrigin()}/rsvp/find/${code}`;

/** An event's public contact collector (M4.1f). */
export const collectUrl = (code: string) => `${appOrigin()}/collect/${code}`;
