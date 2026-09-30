/**
 * The platform agreements an organization accepts (click-wrap). Bumping a version asks every
 * org to accept again before publishing. The texts are DRAFTS until counsel provides the final
 * wording (owner inbox: counsel questions); the version names say so.
 */
export const PLATFORM_AGREEMENTS = {
  platform_tos: { version: '2026-09-draft' },
  dpa: { version: '2026-09-draft' },
} as const;
export type AgreementDocument = keyof typeof PLATFORM_AGREEMENTS;
export const AGREEMENT_DOCUMENTS = Object.keys(PLATFORM_AGREEMENTS) as AgreementDocument[];
