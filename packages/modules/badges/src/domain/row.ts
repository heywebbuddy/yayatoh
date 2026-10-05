import { z } from 'zod';
import type { BadgeDesign, ElementKind } from './design.ts';
import { splitName } from './names.ts';

/**
 * What one badge may print: exactly the fields the template places, nothing else (M5.5a house
 * rule). Email, phone and checkout answers never reach the renderer, except an answer the
 * organizer explicitly mapped to the company or job title field (non-sensitive text questions
 * only, checked when the template is saved). This schema is the allowlist.
 */
export const BadgeRow = z
  .object({
    ticketId: z.uuid(),
    ticketTypeId: z.uuid(),
    firstName: z.string().max(200),
    lastName: z.string().max(200),
    company: z.string().max(200),
    jobTitle: z.string().max(200),
    typeLabel: z.string().max(200),
    /** The ticket's signed yy1 code (ADR 0011), unchanged: the Scan PWA reads a badge as the ticket. */
    code: z.string().max(400),
  })
  .strict();
export type BadgeRow = z.infer<typeof BadgeRow>;

/** A ticket as the badges module reads it (never the holder's email). */
export interface BadgeSource {
  readonly ticketId: string;
  readonly ticketTypeId: string;
  readonly typeName: string;
  readonly holderName: string;
  readonly code: string;
  /** Non-sensitive checkout answers of the ticket's order. */
  readonly answers: Readonly<Record<string, unknown>>;
}

const answerText = (answers: Readonly<Record<string, unknown>>, key: string | null) => {
  if (!key) return '';
  const v = answers[key];
  return typeof v === 'string' ? v.trim().slice(0, 200) : '';
};

export function placedKinds(design: Pick<BadgeDesign, 'front' | 'back'>): Set<ElementKind> {
  return new Set([...design.front, ...design.back].map((e) => e.kind));
}

/** Build a badge's render row through the allowlist: unplaced fields are always blank. */
export function badgeRow(design: BadgeDesign, src: BadgeSource): BadgeRow {
  const on = placedKinds(design);
  const name = splitName(src.holderName);
  return BadgeRow.parse({
    ticketId: src.ticketId,
    ticketTypeId: src.ticketTypeId,
    firstName: on.has('first_name') ? name.first : '',
    lastName: on.has('last_name') ? name.last : '',
    company: on.has('company') ? answerText(src.answers, design.sources.company) : '',
    jobTitle: on.has('job_title') ? answerText(src.answers, design.sources.jobTitle) : '',
    typeLabel: on.has('type_label') ? src.typeName : '',
    code: on.has('qr') ? src.code : '',
  });
}

/** The company a batch sorts by (independent of whether the template prints it). */
export const companyOf = (design: BadgeDesign, answers: Readonly<Record<string, unknown>>) =>
  answerText(answers, design.sources.company);
