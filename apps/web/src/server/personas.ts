/**
 * Seed personas for local and preview environments (roadmap §9: role logins from seed users).
 * They are real Better Auth users created by `pnpm seed` with DEV_PERSONA_PASSWORD. Never in production.
 */
export interface Persona {
  readonly email: string;
  readonly name: string;
  /** Empty for a newcomer with no organization yet (the invite-only signup flow). */
  readonly orgSlug: string;
  readonly role: 'owner' | 'viewer';
  /**
   * Two-step verification on (M1.2c; required for owners). The seed enrols it with a dev-only
   * secret derived from DEV_PERSONA_PASSWORD, and /dev/login answers the challenge with it.
   */
  readonly twoFactor: boolean;
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
  // A newcomer who will own the organization she signs up.
  { email: 'nia@newcomer.test', name: 'Nia Newcomer', orgSlug: '', role: 'owner', twoFactor: true },
  // Platform staff (apps/admin): the staff role comes from the worker CLI, not from an org.
  // Staff get passkeys later (roadmap §10); no org role requires two-step verification here.
  { email: 'omar@yayatoh.test', name: 'Omar Ops', orgSlug: '', role: 'owner', twoFactor: false },
];

export const SEED_ORGS = [
  { slug: 'lakeside-events', name: 'Lakeside Events', profile: 'conference' },
  { slug: 'rosewood-weddings', name: 'Rosewood Weddings', profile: 'wedding' },
] as const;

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
