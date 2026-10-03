import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `ai` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('ai', {
  // `period` is a YYYY-MM month by CHECK.
  credit_accounts: { period: 'vocab' },
  credit_ledger: {
    kind: 'vocab',
    period: 'vocab',
    // Staff adjustments carry a free-text reason; the actor names who spent or granted.
    reason: internal(),
    draft_kind: 'vocab',
    actor: internal(),
  },
  // M6.12b: a brand kit is the org's own working material (console and AI prompts only, never a
  // public page); the tone is a vocabulary word.
  brand_kits: {
    name: internal(),
    voice: internal(),
    tone: 'vocab',
    keywords: internal(),
    avoid: internal(),
    created_by: internal(),
  },
});
