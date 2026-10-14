/** Reading a `/v1` problem+json body (RFC 9457) without trusting its shape. */
export interface ProblemInfo {
  readonly code: string;
  readonly reason: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function readProblem(body: unknown, _status: number): ProblemInfo {
  const problem = isRecord(body) ? body : {};
  const details = isRecord(problem.details) ? problem.details : {};
  return {
    code: typeof problem.code === 'string' ? problem.code : 'internal',
    reason: typeof details.reason === 'string' ? details.reason : null,
    details,
  };
}
