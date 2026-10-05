/**
 * Seed personas for local and preview environments (roadmap §9: role logins from seed users).
 * They are real Better Auth users created by `pnpm seed` with DEV_PERSONA_PASSWORD. Never in production.
 */
export interface Persona {
  readonly email: string;
  readonly name: string;
  /** Empty for a newcomer with no organization yet (the invite-only signup flow). */
  readonly orgSlug: string;
  readonly role: 'owner' | 'viewer' | 'finance';
  /**
   * Two-step verification on (M1.2c; required for owners). The seed enrols it with a dev-only
   * secret derived from DEV_PERSONA_PASSWORD, and /dev/login answers the challenge with it.
   */
  readonly twoFactor: boolean;
  /**
   * What /dev/login says the persona is (batch 3h, owner 2026-10-02): an org `member` shows its role
   * and org; a `newcomer` has no organization yet (sign-up and onboarding); `staff` is Yayatoh staff,
   * who work in the admin console, so its card links there instead of signing in here.
   */
  readonly kind?: 'member' | 'newcomer' | 'staff';
}

export const PERSONAS: readonly Persona[] = [
  {
    email: 'pani@lakeside.test',
    name: 'Pani Digital',
    orgSlug: 'lakeside-events',
    role: 'owner',
    twoFactor: true,
  },
  {
    email: 'jordan@lakeside.test',
    name: 'Jordan Lee',
    orgSlug: 'lakeside-events',
    role: 'viewer',
    twoFactor: false,
  },
  // Finance (M1.6e): refunds, reconciliation and disputes, no event editing. Finance must use
  // two-step verification (M1.2c).
  {
    email: 'fran@lakeside.test',
    name: 'Fran Ledger',
    orgSlug: 'lakeside-events',
    role: 'finance',
    twoFactor: true,
  },
  {
    email: 'maya@rosewood.test',
    name: 'Maya Chen',
    orgSlug: 'rosewood-weddings',
    role: 'owner',
    twoFactor: true,
  },
  {
    email: 'sam@rosewood.test',
    name: 'Sam Rivera',
    orgSlug: 'rosewood-weddings',
    role: 'viewer',
    twoFactor: false,
  },
  // A public organizer with a tenant site and a full calendar (marketplace, M1.11).
  { email: 'lee@harbor.test', name: 'Lee Harbor', orgSlug: 'harbor-arts', role: 'owner', twoFactor: true },
  // A newcomer who will own the organization she signs up.
  {
    email: 'nia@newcomer.test',
    name: 'Nia Newcomer',
    orgSlug: '',
    role: 'owner',
    twoFactor: true,
    kind: 'newcomer',
  },
  // Platform staff (apps/admin): the staff role comes from the worker CLI, not from an org.
  // Staff get passkeys later (roadmap §10); no org role requires two-step verification here.
  {
    email: 'omar@yayatoh.test',
    name: 'Omar Ops',
    orgSlug: '',
    role: 'owner',
    twoFactor: false,
    kind: 'staff',
  },
];

export const SEED_ORGS = [
  { slug: 'lakeside-events', name: 'Lakeside Events', profile: 'conference' },
  { slug: 'rosewood-weddings', name: 'Rosewood Weddings', profile: 'wedding' },
  { slug: 'harbor-arts', name: 'Harbor Arts Collective', profile: 'concert' },
] as const;

/** The admin console's sign-in page (apps/admin on :3001 in development), for the staff persona. */
export const adminSignInUrl = () => `${process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001'}/sign-in`;

export function personaByEmail(email: string): Persona | undefined {
  return PERSONAS.find((p) => p.email === email);
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
