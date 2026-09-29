import { z } from 'zod';

/**
 * The stable reference other modules key by (M5.1b's per-type form paths, M5.5a badges): a
 * registration type's id, its key (stable across renames) and its current name.
 */
export const RegistrationTypeRef = z.object({ id: z.uuid(), key: z.string(), name: z.string() });
export type RegistrationTypeRef = z.infer<typeof RegistrationTypeRef>;
