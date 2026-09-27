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
}

export const PERSONAS: readonly Persona[] = [
  { email: 'pani@lakeside.test', name: 'Pani Digital', orgSlug: 'lakeside-events', role: 'owner' },
  { email: 'jordan@lakeside.test', name: 'Jordan Lee', orgSlug: 'lakeside-events', role: 'viewer' },
  { email: 'maya@rosewood.test', name: 'Maya Chen', orgSlug: 'rosewood-weddings', role: 'owner' },
  { email: 'sam@rosewood.test', name: 'Sam Rivera', orgSlug: 'rosewood-weddings', role: 'viewer' },
  // A public organizer with a tenant site and a full calendar (marketplace, M1.11).
  { email: 'lee@harbor.test', name: 'Lee Harbor', orgSlug: 'harbor-arts', role: 'owner' },
  { email: 'nia@newcomer.test', name: 'Nia Newcomer', orgSlug: '', role: 'owner' },
  // Platform staff (apps/admin): the staff role comes from the worker CLI, not from an org.
  { email: 'omar@yayatoh.test', name: 'Omar Ops', orgSlug: '', role: 'owner' },
];

export const SEED_ORGS = [
  { slug: 'lakeside-events', name: 'Lakeside Events', profile: 'conference' },
  { slug: 'rosewood-weddings', name: 'Rosewood Weddings', profile: 'wedding' },
  { slug: 'harbor-arts', name: 'Harbor Arts Collective', profile: 'concert' },
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
