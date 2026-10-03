import type { AdminSql } from '@yayatoh/db/testing';

/**
 * The canary person of the DSAR propagation test (M6.1c): one person planted in every table a
 * data-subject contributor covers, then erased; afterwards no text column of the org may still
 * hold their address, last name or phone.
 */
export interface DsarPerson {
  /** Normalized (lower case). */
  readonly email: string;
  readonly firstName: string;
  /** Unique per run: the token the scan looks for. */
  readonly lastName: string;
  /** `firstName lastName`. */
  readonly name: string;
  /** E.164, never assigned (+1 999 555 …). */
  readonly phone: string;
}

export const dsarPerson = (tag: string): DsarPerson => {
  const t = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastName = `Quillfeather${t.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)] as string)}`;
  const digits = String(Number.parseInt(t.slice(-6), 36) % 10_000).padStart(4, '0');
  return {
    email: `zelda.${t}@quill-canary.test`,
    firstName: 'Zelda',
    lastName,
    name: `Zelda ${lastName}`,
    phone: `+1999555${digits}`,
  };
};

/** What a planter gets. `ids` is shared: planters that run later read what earlier ones made. */
export interface PlantCtx {
  /** Superuser connection (RLS does not apply: always scope by `org_id`). */
  readonly admin: AdminSql;
  readonly orgId: string;
  readonly ownerId: string;
  /** The fixture's published event (`createOrgFixture`). */
  readonly eventId: string;
  readonly person: DsarPerson;
  readonly ids: Record<string, string>;
}

/**
 * Plants the person in a module's tables (inserting rows, or pointing the fixture's rows at the
 * person) and returns every `schema.table` it wrote the person into.
 */
export type Planter = (p: PlantCtx) => Promise<readonly string[]>;
