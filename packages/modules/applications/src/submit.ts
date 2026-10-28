import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { ApplicationInput } from './domain/rules.ts';

export interface SubmitResult {
  readonly id: string;
  /** The same sender already has this kind of application open: no second record was made. */
  readonly duplicate: boolean;
}

/**
 * Store an application from the public form. The page has already passed the human check and the
 * rate limits; this validates the fields again and writes through the SECURITY DEFINER
 * `applications.submit` (app_user has no privileges on the tables). Throws a ZodError for bad input.
 */
export async function submitApplication(value: unknown): Promise<SubmitResult> {
  const input = ApplicationInput.parse(value);
  const [row] = await withoutTenant((tx) =>
    tx.execute<{ result: { id: string; duplicate: boolean } }>(
      sql`select applications.submit(${JSON.stringify(input)}::jsonb) as result`,
    ),
  );
  if (!row) throw new Error('application not stored');
  return row.result;
}

/** Record that the confirmation email went out (the audit log of the application). */
export async function logApplicantEmail(id: string, kind: string, subject: string): Promise<void> {
  await withoutTenant((tx) =>
    tx.execute(sql`select applications.log_email(${id}::uuid, ${kind}, ${subject}, 'applicant')`),
  );
}
