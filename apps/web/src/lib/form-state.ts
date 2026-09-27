/** What a console Server Action returns to its form (M1.4c/d forms). */
export interface FormState {
  readonly ok: boolean;
  /** DomainError code (shown via `errors.*`), or null. */
  readonly code: string | null;
  /** Inputs the server rejected (Zod issue paths or `details.field`), first segment only. */
  readonly fields?: readonly string[];
  /** `details.reason`, for messages more specific than the code. */
  readonly reason?: string;
  /** 1-based line (FAQ: block) of a list-shaped section's text that failed to parse. */
  readonly line?: number;
  /** Changes on every success so forms can reset/announce even when nothing else changed. */
  readonly stamp?: number;
}

export const INITIAL_FORM_STATE: FormState = { ok: false, code: null };
