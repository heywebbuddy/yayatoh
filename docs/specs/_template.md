# Spec: <Milestone ID> — <Title>

<!--
Copy to docs/specs/<milestone>/<slice>.md. Replace every <placeholder>.
Delete guidance comments before approval. Write "None" rather than deleting a section.
Precedence: owner decisions > accepted ADRs > roadmap > research.
-->

- **Milestone:** <M1.x> (roadmap §<n>)
- **Status:** Draft | Approved (owner, YYYY-MM-DD)
- **Risk tags:** <db-migration, auth, payments, tenancy, infra, mobile-contract, legal-copy, or none>
- **Related ADRs:** <ADR numbers>

## 1. Goal and users
<!-- One paragraph: the problem, who has it (organizer role, attendee, staff, platform admin), and what success looks like. -->

## 2. References
- **Vision:** <quote or section of docs/vision.md>
- **Parity matrix rows:** <ids from docs/parity/parity.yaml, with disposition>
- **Legacy evidence:** <docs/legacy/... or none>

## 3. Scope
**In:**
- <item>

**Out:**
- <item, and where it lands instead>

## 4. `touches:`
<!-- Every path this work may change. Anything outside needs a spec update. -->
```yaml
touches:
  - packages/modules/<module>/**
  - apps/<app>/...
```

## 5. Data model
<!-- Tables and columns, owning module schema, state machines. -->
| Table | Change | Notes |
|---|---|---|
| `<schema>.<table>` | new / add column / ... | |

**RLS notes:**
- [ ] Tenant tables use `tenantTable()` (`org_id NOT NULL`, ENABLE + FORCE RLS, canonical policy, org-leading indexes, composite FKs, org-scoped uniques)
- [ ] Event-scoped or money tables add the RESTRICTIVE policy they need
- [ ] New tables registered in the isolation fixtures
- [ ] `@private` columns listed (for the canary leak test)

**Migration:** <expand/contract steps, `lock_timeout`, concurrent indexes, destructive steps needing owner approval>

## 6. API diff
<!-- /v1 changes must be additive (oasdiff). /api/v2 is frozen: any change needs an updated golden HAR plus owner approval. -->
- **`/v1`:** <new routes, fields, error codes>
- **Server Actions / commands:** <command name, permission, entitlement key, idempotency>
- **`/api/v2`:** none | <change + HAR + approval>

## 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `<module>.<event>.v1` | 1 | | | yes/no |

## 8. Entitlements and flags
- **Module key(s):** <key>
- **Profiles affected:** <wedding, gala, concert, conference, community, agency, other>
- **Release flag:** <name, owner, removal milestone>
- **Kill switch:** <if any>

## 9. ELT impact
<!-- Effect on the legacy migration (packages/etl): new mappings, transforms, validations, golden queries. -->

## 10. Acceptance criteria
<!-- Given/When/Then, each with a stable ID and the test that proves it. -->
| ID | Given / When / Then | Test |
|---|---|---|
| AC-<M>-01 | **Given** <context> **When** <action> **Then** <outcome> | `<path/to/test>` (unit / integration / isolation / e2e) |

## 11. Security and privacy
<!-- Authz rules, step-up, allowlist serializers for every public output, PII and encryption, retention, rate limits, audit rows. -->

## 12. Performance budget
<!-- API p95 (reads ≤200 ms, writes ≤400 ms), bundle limits, LCP/INP/CLS, other SLOs from roadmap §9–§10. -->

## 13. Rollout
<!-- Flag plan, per-org or % rollout, migration order, rollback, monitoring and alerts. -->

## 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | | | |

## 15. Demo checklist
- [ ] <step the owner can follow on the preview URL>

## 16. Owner tasks
<!-- Anything only the owner can do; also add to docs/owner-inbox.md with this milestone. -->
- [ ] <task>
