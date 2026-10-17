/**
 * Compliance answers as data (M7.5a): export compliance, the age-rating questionnaires and the
 * App Review guideline answers in `apps/<app>/store/compliance.json`. The review notes in
 * `store.config.json` must mention every guideline the answers rely on, and the export-compliance
 * answer must match what `app.config.ts` writes into the Info.plist.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ComplianceInput {
  readonly compliance: unknown;
  /** `store.config.json` -> apple.review.notes */
  readonly reviewNotes: string;
  /** `ios.config.usesNonExemptEncryption` from the production Expo config. */
  readonly configUsesNonExemptEncryption: boolean | undefined;
  /** Guideline ids the review notes must cite for this app. */
  readonly requiredGuidelines: readonly string[];
}

export const MOBILE_GUIDELINES = ['3.1.3(e)', '4.8', '5.1.1(v)'] as const;
export const STAFF_GUIDELINES = [] as const;

export function checkCompliance({
  compliance,
  reviewNotes,
  configUsesNonExemptEncryption,
  requiredGuidelines,
}: ComplianceInput): string[] {
  const errors: string[] = [];
  if (!isObject(compliance)) return ['compliance.json: not an object'];
  const exp = isObject(compliance.exportCompliance) ? compliance.exportCompliance : null;
  if (!exp) errors.push('exportCompliance: missing');
  else {
    if (typeof exp.usesNonExemptEncryption !== 'boolean')
      errors.push('exportCompliance.usesNonExemptEncryption: true or false');
    else if (exp.usesNonExemptEncryption !== configUsesNonExemptEncryption)
      errors.push(
        `exportCompliance.usesNonExemptEncryption (${String(exp.usesNonExemptEncryption)}) does not match ios.config.usesNonExemptEncryption in app.config.ts (${String(configUsesNonExemptEncryption)})`,
      );
    if (exp.algorithms !== 'standard-only')
      errors.push(
        'exportCompliance.algorithms: only standard, published algorithms (no proprietary cryptography)',
      );
    for (const k of ['inApp', 'classification', 'annualReport', 'owner'] as const)
      if (!exp[k]) errors.push(`exportCompliance.${k}: missing`);
  }

  const rating = isObject(compliance.contentRating) ? compliance.contentRating : null;
  if (!rating) errors.push('contentRating: missing');
  else {
    const apple = isObject(rating.apple) ? rating.apple : null;
    const play = isObject(rating.play) ? rating.play : null;
    if (!apple || typeof apple.expected !== 'string') errors.push('contentRating.apple.expected: missing');
    if (!apple || !isObject(apple.capabilities)) errors.push('contentRating.apple.capabilities: missing');
    if (!play || typeof play.category !== 'string' || !isObject(play.answers))
      errors.push('contentRating.play: category and answers');
  }

  const guidelines = isObject(compliance.guidelines) ? compliance.guidelines : {};
  for (const id of requiredGuidelines) {
    const g = guidelines[id];
    if (!isObject(g) || typeof g.answer !== 'string' || typeof g.where !== 'string')
      errors.push(`guidelines.${id}: answer and where`);
    if (!reviewNotes.includes(id)) errors.push(`the review notes do not cite guideline ${id}`);
  }
  for (const [id, g] of Object.entries(guidelines))
    if (!isObject(g) || typeof g.answer !== 'string' || typeof g.where !== 'string')
      errors.push(`guidelines.${id}: answer and where`);

  const play = isObject(compliance.play) ? compliance.play : null;
  if (
    !play ||
    typeof play.accountDeletionUrl !== 'string' ||
    !/^\$\{STORE_[A-Z_]+\}$/.test(play.accountDeletionUrl)
  )
    errors.push('play.accountDeletionUrl: a STORE_… placeholder (Play wants a web link for deletion)');
  return errors;
}
