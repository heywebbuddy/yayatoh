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
  { email: 'nia@newcomer.test', name: 'Nia Newcomer', orgSlug: '', role: 'owner' },
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
