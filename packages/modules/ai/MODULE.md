# ai (tier 6)

AI drafting for event copy (M1.4f) and the per-org AI credits ledger (decision D12: a small free allowance per org, metered at M6.6). Owns Postgres schema `ai`.

**Invariants**
- `AiDrafter` is a port. `fakeDrafter` (deterministic) serves dev, CI and previews; `anthropicDrafter` is a stub until the owner's provider account exists (owner inbox). `drafterFromEnv` returns null in production without a provider: drafting is off, and nothing is debited.
- Organizer text is **data**: it is sent inside one JSON block with `<`, `>` and `&` escaped, and the instructions forbid following anything inside it. Drafts are cleaned (`cleanDraft`: plain text for taglines, the Markdown subset for descriptions, parsed question/answer pairs for FAQs) and shown as a **preview**. Nothing is saved or published by this module; the organizer accepts through the normal event commands (which audit and sanitize again).
- Credits: `ai.credit_accounts` (one row per org, `balance >= 0` CHECK) is locked `FOR UPDATE` for every change, so concurrent drafts serialize and the balance never goes negative. `ai.credit_ledger` is append-only (UPDATE/DELETE revoked from `app_user`) and its amounts always sum to the balance.
- The free allowance (`FREE_MONTHLY_CREDITS`, pending owner) tops the balance **up to** the allowance at the first use in each UTC month; extra credits granted on top are kept.
- One draft costs one credit. A provider failure, a timeout or an unusable draft refunds it (once per debit, enforced by a unique index).
- Drafting needs `events:write` and the `ai` entitlement; reading the balance `events:read`. Staff adjustments (`ai.adjustCredits`) are platform-only.
