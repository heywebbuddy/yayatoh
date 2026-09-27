/**
 * Seed personas for local and preview environments (roadmap §9: role logins use one-time links
 * from seed users). Replaced by Better Auth users in M1.2. Never enabled in production.
 */
export interface Persona {
  readonly userId: string;
  readonly name: string;
  readonly initials: string;
  readonly orgSlug: string;
  readonly role: 'owner' | 'viewer';
}

export const PERSONAS: readonly Persona[] = [
  {
    userId: '0190f5f6-0000-7000-8000-00000000a001',
    name: 'Pani Digital',
    initials: 'PD',
    orgSlug: 'lakeside-events',
    role: 'owner',
  },
  {
    userId: '0190f5f6-0000-7000-8000-00000000a002',
    name: 'Jordan Lee',
    initials: 'JL',
    orgSlug: 'lakeside-events',
    role: 'viewer',
  },
  {
    userId: '0190f5f6-0000-7000-8000-00000000b001',
    name: 'Maya Chen',
    initials: 'MC',
    orgSlug: 'rosewood-weddings',
    role: 'owner',
  },
  {
    userId: '0190f5f6-0000-7000-8000-00000000b002',
    name: 'Sam Rivera',
    initials: 'SR',
    orgSlug: 'rosewood-weddings',
    role: 'viewer',
  },
];

export const SEED_ORGS = [
  { slug: 'lakeside-events', name: 'Lakeside Events', profile: 'conference' },
  { slug: 'rosewood-weddings', name: 'Rosewood Weddings', profile: 'wedding' },
] as const;

export function personaById(userId: string): Persona | undefined {
  return PERSONAS.find((p) => p.userId === userId);
}
