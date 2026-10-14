/** Reading `/v1` problem+json (RFC 9457) bodies without trusting their shape. */

export interface ProblemInfo {
  readonly status: number;
  readonly code: string;
  readonly reason: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stable fields of a problem body: `code`, `details.reason` and the rest of `details`. */
export function readProblem(body: unknown, status: number): ProblemInfo {
  const problem = isRecord(body) ? body : {};
  const details = isRecord(problem.details) ? problem.details : {};
  return {
    status,
    code: typeof problem.code === 'string' ? problem.code : 'internal',
    reason: typeof details.reason === 'string' ? details.reason : null,
    details,
  };
}

export const stringDetail = (p: ProblemInfo, key: string): string | null => {
  const v = p.details[key];
  return typeof v === 'string' ? v : null;
};
