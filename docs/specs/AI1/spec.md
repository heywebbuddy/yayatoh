# Spec: AI1 — AI phase 1: switch on, measure, and four quick wins

- **Milestone:** AI1 (proposed; not yet in `docs/roadmap.md`. Builds on M1.4f and M6.12b)
- **Status:** Approved (owner, 2026-11-02), with the recommended defaults in section 16 until the owner says otherwise
- **Risk tags:** `db-migration`, `tenancy`, `payments` (credits), `infra`, `legal-copy` (sub-processor)
- **Related decisions and ADRs:** D12 (AI credits), P6-7, P6-10 (Claude behind the `AiDrafter` port)

## 1. Goal and users
The AI module is built, but production AI stays off until a provider key is set. This phase switches it
on with cost tracking and quality checks, then adds four features to surfaces that already exist:

| Who | Gets |
|---|---|
| Organizers | A summary of an event's reviews and survey answers |
| Support staff in an org | Sorted conversations and refund requests, with a draft reply |
| Buyers and organizers | Help center answers with links to the articles they come from |
| Organizers and marketers | Draft translations of help articles and campaigns |

**Changes made while building (2026-11-02):**
- The help center belongs to the platform content org, so help answers and help article translation exist only there, charged to that org's credits. Other orgs have no public help center.
- `ai.answerHelp` runs through `askHelp`, and the org-wide daily ceiling became a per-device, per-address and hourly rate limit (`helpAnswer`), with the org's credit balance as the backstop.
- Features sit in the app, not as new commands per screen: the AI module takes text and returns text, and each page reads its data with its own permission. The module therefore has no new imports from lower-level modules.
- Campaign copies use the existing create and save commands, under `marketing:write`. No new `campaigns` command was needed.
- There is no separate module key for help answers; `AI_DISABLED_PURPOSES=help_answer` switches them off.
- One translation is limited to 2,000 words, so it fits the caller's time budget. Longer texts are refused before any credit is spent.

Success: every AI call has a known model and cost, cheaper models are adopted only where measured quality
holds, and AI still never saves, sends, publishes or decides anything by itself.

## 2. References
- **AI module rules:** `packages/modules/ai/MODULE.md`. Note: it still calls `anthropicDrafter` a stub; the adapter in `drafter.ts` is real. Fix this line in increment 1.
- **Owner items already open:** `docs/owner-inbox.md`, "AI drafting provider and allowance" and "M6.12b".
- **Prices used for estimates:** Anthropic rates from a reference dated 2026-10-06. Confirm before budgeting.
- **Parity matrix rows:** none. **Legacy evidence:** none (legacy credits were never implemented).

## 3. Scope
**In:**
- **Provider on:** the existing Anthropic adapter in production, behind a per-feature kill switch.
- **Routing:** a model, effort, output limit and credit cost per feature, replacing one global `AI_MODEL`.
- **Usage log:** model, tokens, cost and outcome for every call.
- **Quality checks (evals):** fixtures and a manual script that decide routing.
- **Review and survey insights** (organizer presses a button).
- **Support assist** for conversations and refund requests (staff member presses a button).
- **Help answers** on the help center search page, cited to published articles.
- **Draft translation** of help articles and campaigns.

**Out:**
- **Event page translation:** events have no per-language content today, so this needs its own data model and public rendering. Increment 7, only if approved (Owner decision 3).
- **Embeddings and matchmaking:** phase 4 of the AI plan. Matchmaking stays on shared interests.
- **Automatic background runs:** nothing here spends credits without someone pressing a button, the same caution as the owner-inbox note on automatic matchmaking refresh. The help answer's asker is the one exception, and it follows the attendee assistant's existing model.
- **Batch API:** every call here is interactive, and batches reject the `fallbacks` parameter the adapter sends.
- **Translating legal text:** policies, receipts, certificates and terms stay with `legal-copy` review.
- **AI approving or declining refunds:** never in scope.

## 4. `touches:`
```yaml
touches:
  - packages/modules/ai/src/{drafter,spend,credits,compose,schema,index,private-columns}.ts
  - packages/modules/ai/src/domain/{ledger,compose}.ts
  - packages/modules/ai/src/domain/routes.ts            # new
  - packages/modules/ai/src/{insights,support-assist,help-answers,translate}.ts  # new
  - packages/modules/ai/src/domain/{insights,support-assist,help-answers,translate}.ts  # new
  - packages/modules/ai/evals/**                        # new
  - packages/modules/ai/tests/**, packages/modules/ai/MODULE.md
  - packages/platform/src/modules.ts                    # the three feature keys
  - packages/platform/src/security/rate-limit.ts        # helpAnswer
  - packages/db/drizzle/**                              # next free number, plus meta
  - packages/testing/src/fixtures.ts, packages/testing/tests/ai-phase1.int.test.ts, packages/testing/tests/dsar/**
  - apps/web/src/server/ai.ts
  - apps/web/src/components/ai/**, apps/web/src/components/help/help-answer.tsx, apps/web/src/components/refund-request-panel.tsx
  - apps/web/src/server/ai-insights.ts, apps/web/src/app/api/dev/ai-features/route.ts  # new
  - apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/reviews/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/surveys/**
  - apps/web/src/app/[locale]/o/[org]/(org)/messages/**
  - apps/web/src/app/[locale]/o/[org]/(org)/refund-requests/**
  - apps/web/src/app/[locale]/o/[org]/(org)/help-center/**
  - apps/web/src/app/[locale]/o/[org]/(org)/campaigns/**
  - apps/web/src/app/[locale]/help/search/**, apps/web/src/app/[locale]/help/actions.ts
  - apps/web/src/content/sub-processors.ts              # only once counsel approves (Owner task 2)
  - apps/web/messages/*.json
  - apps/web/e2e/ai-phase1.spec.ts
  - .env.example, docs/owner-inbox.md, docs/specs/AI1/spec.md
```

## 5. Data model
| Table | Change | Notes |
|---|---|---|
| `ai.usage` | new | One row per provider call: `purpose`, `model`, `input_tokens`, `cache_read_tokens`, `output_tokens`, `cost_micros`, `latency_ms`, `outcome` (`ok`, `refused`, `unusable`, `unavailable`), `debit_id`, `event_id`. **No prompt or reply text.** Append-only for `app_user`, like the ledger |
| `ai.insights` | new | Saved summary: `event_id`, `subject` (`reviews`, `survey`), `subject_id`, `input_hash`, `result` (JSON), `based_on`, `total`, `model`, `usage_id`. Unique per org and subject. Lets a re-press with unchanged input cost nothing |
| `ai.credit_ledger` | widen check | Migration replaces `credit_ledger_draft_kind_check` with the new purposes: `insights`, `support_assist`, `help_answer`, `translate` |

**RLS notes:**
- [ ] Both tables use `tenantTable()`
- [ ] Both registered in the isolation fixtures
- [ ] `ai.insights.result` listed as `@private` and covered by the DSAR tests, because a summary is derived from people's words
- [ ] `ai.usage` holds no personal data by construction; a test asserts the column list

**Migration:** additive only: two new tables and one widened check, under the usual `lock_timeout`. Rollback: the module keys go off and the tables stay.

### Routing table (`domain/routes.ts`)
Starting values. Increment 2's evals may change a row; that change is one line and needs no migration.

| Purpose | Starting model | Effort | Credits | Why |
|---|---|---|---|---|
| Existing drafts, event setup, audience | `claude-opus-5-5` | low | 1 | Unchanged until measured |
| Attendee assistant | `claude-opus-5-5` | low | 1 | Unchanged until measured |
| `insights` | `claude-haiku-5-5` | medium | 1 per started 100 answers, max 5 | Volume is high and output is checkable |
| `support_assist` | `claude-sonnet-5-5` | low | 1 | One call both sorts and drafts, and a person reads the result |
| `help_answer` | `claude-sonnet-5-5` | low | 1 | Must stay grounded in its sources |
| `translate` | `claude-sonnet-5-5` | medium | 1 per started 1,000 source words | Tone and formatting matter |

**Adapter rules:**
- Send `fallbacks: 'default'` for Opus and Sonnet only. Haiku 5.5 has no server-side refusal fallback, so a Haiku refusal is an `unusable` outcome and is refunded.
- `AI_MODEL` stays as an emergency override of every route.
- `debit()` already accepts a cost; `spendPair` passes the route's credits through and refunds the same amount.

**Estimated provider cost per call** (assumed token counts, for sizing only):

| Call | Assumed tokens in / out | Cost |
|---|---|---|
| Insights, 500 reviews on Haiku | 125,000 / 2,000 | about $0.014 |
| Support assist on Sonnet | 3,000 / 800 | about $0.014 |
| Help answer on Sonnet | 6,000 / 500 | about $0.017 |
| Translate 1,000 words on Sonnet | 2,000 / 2,000 | about $0.024 |

## 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Port:** `AiDrafter` calls return `{ text, usage }` instead of a string and accept the route. `fakeDrafter` reports fixed usage so tests can assert logging.
- **Commands and queries** (permission is the feature's own; entitlement `ai`; all charged through a new spend pair):

| Name | Permission | Notes |
|---|---|---|
| `summarizeAnswers` (reviews) | `events:write` | Visible reviews only. Staff with `events:read` read a saved summary |
| `summarizeAnswers` (survey) | `messages:send` | Staff with `messages:read` read a saved summary |
| `assistSupport` (conversation) | `messages:send` | Returns a category, urgency, and a draft that fills the reply box unsent |
| `assistSupport` (refund request) | `orders:refund` | Returns a summary and a draft decline reason. Approving and declining still use their existing commands |
| `askHelp` | `public:ai.assistant` | Rate limited first, like the attendee assistant |
| `translateContent` (help article) | `marketing:write` | The page saves a **draft** row in the target locale |
| `translateContent` (campaign) | `marketing:write` | The page saves an **unsent draft** copy, without the audience |

## 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `ai.credits_spent` | 1 (existing) | ai | billing `ai_credits` meter | no |
| `ai.credits_refunded` | 1 (existing) | ai | billing `ai_credits` meter | no |

No new events. Variable credit costs already flow through the existing amount field.

## 8. Entitlements and flags
- **Module key:** `ai` (existing). **Profiles affected:** all.
- **Feature gates:** the app has no general flag system; features are gated by module keys in `packages/platform/src/modules.ts`, as `ai_seating` is. Each is off until granted to an org: `ai_insights`, `ai_support_assist`, `ai_translate`.
- **Kill switch (new):** `AI_DISABLED_PURPOSES`, a comma-separated environment variable that turns a purpose off with an environment change; `AI_PROVIDER` unset turns all AI off, as today.

## 9. ELT impact
None.

## 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-AI1-01 | **Given** the provider is on **When** any purpose runs **Then** it uses its route's model and effort, and one `ai.usage` row is written whatever the outcome | `ai/tests/routes.test.ts`, `ai-phase1.int.test.ts` |
| AC-AI1-02 | **Given** a route costs N credits **When** the call fails **Then** exactly N are refunded, once, and the meter nets to zero | `ai-phase1.int.test.ts` |
| AC-AI1-03 | **Given** a Haiku route **When** a request is sent **Then** it has no `fallbacks`, and a refusal refunds | `ai/tests/routes.test.ts` |
| AC-AI1-04 | **Given** 800 reviews **When** an organizer summarizes **Then** the result says it is based on the newest 500 of 800, and no input is dropped silently | `ai/tests/insights.test.ts`, e2e |
| AC-AI1-05 | **Given** a saved summary and unchanged input **When** pressed again **Then** no provider call and no debit happen | `ai-phase1.int.test.ts` |
| AC-AI1-06 | **Given** hidden or reported reviews **When** summarizing **Then** they are not sent | `ai-phase1.int.test.ts` |
| AC-AI1-07 | **Given** a summary reply **When** it cites a quote **Then** the quote shown is the stored text of a real answer id; unknown ids are removed | `ai/tests/insights.test.ts` |
| AC-AI1-08 | **Given** a buyer's message contains instructions to the AI **When** assist runs **Then** they are treated as data, and nothing is sent or changed | `ai/tests/support-assist.test.ts`, eval fixture |
| AC-AI1-09 | **Given** a draft reply **When** assist finishes **Then** it is only in the reply box, no message exists until the staff member sends | e2e |
| AC-AI1-10 | **Given** a refund request **When** assist runs **Then** its status, decision fields and refund are unchanged | `ai-phase1.int.test.ts` |
| AC-AI1-11 | **Given** a question the articles don't cover **When** asked **Then** the answer says so and offers search results, with no invented answer | `ai/tests/help-answers.test.ts`, eval fixture |
| AC-AI1-12 | **Given** a help answer **Then** every citation resolves to a published article in that org and audience | `ai-phase1.int.test.ts` |
| AC-AI1-13 | **Given** a Markdown article or campaign with merge fields **When** translated **Then** structure, links and merge fields survive, and a damaged reply is refused and refunded | `ai/tests/translate.test.ts` |
| AC-AI1-14 | **Given** a target-language version exists **When** translating **Then** it is not overwritten without an explicit confirmation | `ai-phase1.int.test.ts`, e2e |
| AC-AI1-15 | **Given** two orgs **Then** no prompt, usage row or insight crosses between them | isolation suite, `ai-phase1.int.test.ts` |
| AC-AI1-16 | **Given** a viewer, an org without `ai`, no credits, or a disabled purpose **Then** each is refused with its proper message and the manual path still works | `ai-phase1.int.test.ts`, e2e |
| AC-AI1-17 | All new panels work by keyboard, pass axe in both themes, and work in Arabic right-to-left | `e2e/ai-phase1.spec.ts` |
| AC-AI1-18 | **Given** the eval set **When** a route's model changes **Then** the score table records it, and the change is made only if the thresholds in section 13 hold | `packages/modules/ai/evals/README.md` (manual) |

CI always uses `fakeDrafter`. The eval script spends real money, so it runs only by hand and never in CI.

## 11. Security and privacy
- **Untrusted text:** reviews, survey answers, buyer messages and articles are data, sent in the existing escaped JSON block, with the same instruction not to obey it.
- **Minimum data:**
  - Insights: answer text only, with no names, emails or respondent ids. Question-level exclusion for sensitive form fields. Sealed accessibility answers are never sent.
  - Support assist: the thread or request text and the event name. No email, payment details or other tickets.
  - Help answers: published articles and the question. Questions are not stored.
- **Replies are validated, never trusted:** categories come from a fixed list, citations and quotes must resolve to real ids, and text is cleaned the way `cleanDraft` cleans drafts.
- **No automatic action:** an AI label never changes a status, and there are no AI-only routes to send, publish or refund.
- **Disclosure:** AI text is labelled as a draft or AI-generated wherever it is shown, including help answers to the public.
- **Audit:** spending stays audited through the existing spend commands; the new commands audit target and purpose only.
- **Rate limits:** `helpAnswer` per device, per address and per hour across the help center, so a public page can't drain the balance quickly. Answers are asked for by button, so a search spends nothing.
- **Retention:** `ai.insights` is deleted with its event and refreshed when its input changes. `ai.usage` holds no personal data; retention follows the credit ledger.
- **Sub-processor:** Anthropic is **not** listed in `apps/web/src/content/sub-processors.ts` today. This blocks real buyer or attendee text from reaching the provider; see Owner task 2.

## 12. Performance budget
- Calls stay inside the existing 25 s adapter timeout and 30 s caller budget, with the panel showing progress.
- Large insight runs must fit that budget on Haiku; the eval run measures this. If they don't, lower the 500-answer cap.
- Page loads are unaffected: AI code runs only when someone presses a button or asks a question.

## 13. Rollout
1. Set the key in production with the new module keys off. Enable the existing features for internal test orgs first, then everyone.
2. Watch `ai.usage` for a week: cost per feature, refusal and failure rates.
3. Run evals and record the results before changing any route.
4. Turn on features one at a time, on internal orgs first.

**Route change thresholds** (proposed): safety and injection fixtures must pass 100%. Graded quality may drop at most 3 points out of 100 from the Opus baseline. p95 latency must stay inside the caller budget.

**Rollback:** the purpose's kill switch, then its module key. **Alerts:** failure rate above 5% over an hour for a purpose, and daily cost above the owner's limit.

## 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | Routing, usage log, variable credits, kill switch, and the `MODULE.md` fix | `ai`, migration, tests | `db-migration`, `payments` |
| 2 | Eval fixtures and manual script; baseline run | `ai/evals` | none |
| 3 | Review and survey insights | `ai`, reviews and surveys pages | `tenancy` |
| 4 | Support assist | `ai`, messages and refund pages | `tenancy` |
| 5 | Help answers | `ai`, help pages | `tenancy` |
| 6 | Translation of help articles and campaigns | `ai`, help and campaign pages, possibly `campaigns` | `tenancy` |
| 7 | **Only if approved:** event page translation | Separate spec | `db-migration` |

Increments 3 to 6 are independent after 1 and 2, and can ship in any order.

## 15. Demo checklist
- [ ] Summarize a seeded event's reviews; press again and see no new charge.
- [ ] Open a conversation, press Assist, edit the draft, and send it yourself.
- [ ] Open a refund request, press Assist, and confirm its status hasn't changed.
- [ ] Ask the help center a covered question and an uncovered one.
- [ ] Translate an article to Arabic, check it right-to-left, and find it saved as a draft.
- [ ] See each call's model and cost in `ai.usage`.

## 16. Owner tasks
Add these to `docs/owner-inbox.md` when this spec is approved.

- [ ] **1. Provider account:** create the Anthropic account, set `ANTHROPIC_API_KEY` and `AI_PROVIDER=anthropic` on the Railway `web` service, and set a monthly spend limit on the account.
- [ ] **2. Legal (blocker):** Anthropic is missing from the sub-processor list. Have counsel approve adding it, and review the privacy notice and customer notice period, before any buyer or attendee text is sent. If Voyage is added later, it needs the same.
- [ ] **3. Decision: event page translation.** Include it as increment 7, or leave it for later? Recommended: a separate spec after increment 6.
- [ ] **4. Decision: credits.** Approve the costs in the routing table, and the free allowance (20 a month today, pending owner).
- [ ] **5. Credits for the help center:** answers are charged to the platform content org, whose free allowance is 20 a month. Grant it enough credits before turning this on.
- [ ] **6. Translation review:** name the translation owner (already open since M1.1). AI translations stay drafts until a person publishes them.
