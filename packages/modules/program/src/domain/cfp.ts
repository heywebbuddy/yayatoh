/**
 * M5.3b call for papers: the pure rules (no database). The commands in `cfp.ts` call these.
 */

export type CfpCallState = {
  readonly status: string;
  readonly closesAt: Date | null;
};

/** Why the public form takes no proposal right now, or `open`. */
export type CfpOpenness = 'open' | 'not_open' | 'closed' | 'past_deadline';

export function cfpOpenness(call: CfpCallState | null, now: Date): CfpOpenness {
  if (!call || (call.status !== 'open' && call.status !== 'closed')) return 'not_open';
  if (call.status === 'closed') return 'closed';
  if (call.closesAt && call.closesAt.getTime() <= now.getTime()) return 'past_deadline';
  return 'open';
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type CoSpeakerInput = { readonly name: string; readonly email: string };

/**
 * Co-speakers as stored: trimmed, emails lowercased, in the order given. Refused (with the index of
 * the offending row) when there are more than allowed, one repeats an address, or one is the
 * submitter.
 */
export function checkCoSpeakers(
  list: readonly CoSpeakerInput[],
  leadEmail: string,
  max: number,
):
  | { ok: true; coSpeakers: CoSpeakerInput[] }
  | { ok: false; reason: 'too_many' | 'duplicate'; index: number } {
  if (list.length > max) return { ok: false, reason: 'too_many', index: max };
  const seen = new Set([normalizeEmail(leadEmail)]);
  const out: CoSpeakerInput[] = [];
  for (const [index, c] of list.entries()) {
    const email = normalizeEmail(c.email);
    if (seen.has(email)) return { ok: false, reason: 'duplicate', index };
    seen.add(email);
    out.push({ name: c.name.trim(), email });
  }
  return { ok: true, coSpeakers: out };
}

/** Reviewers' scores out of 5: the mean to one decimal, or null with no review yet. */
export function averageScore(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/**
 * The placeholder times of an accepted proposal's draft session: the event's start for the
 * requested length (never past the event's end). The organizer places it before it goes public.
 */
export function draftSessionTimes(
  event: { readonly startsAt: Date; readonly endsAt: Date },
  durationMinutes: number,
): { startsAt: Date; endsAt: Date } {
  const startsAt = event.startsAt;
  const wanted = startsAt.getTime() + durationMinutes * 60_000;
  const endsAt = new Date(Math.min(wanted, Math.max(event.endsAt.getTime(), startsAt.getTime() + 60_000)));
  return { startsAt, endsAt };
}

export type ReviewerView = {
  speakerName: string | null;
  speakerTitle: string | null;
  speakerCompany: string | null;
  speakerBio: string | null;
  coSpeakers: { name: string }[];
  answers: { label: string; value: string }[];
};

/**
 * What a reviewer may see of the people behind a proposal: everything, or under blind review
 * nothing that names them (speaker, co-speakers and the custom answers, which may identify them).
 */
export function forReviewer(s: ReviewerView, blind: boolean): ReviewerView {
  if (!blind) return s;
  return {
    speakerName: null,
    speakerTitle: null,
    speakerCompany: null,
    speakerBio: null,
    coSpeakers: [],
    answers: [],
  };
}
