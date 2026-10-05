# SOC 2 evidence: the owner's production steps (M5.11a)

The weekly **Evidence** workflow (`.github/workflows/evidence.yml`) builds everything that can be
built from the repository and a seeded CI database. What needs production or an admin login is
here, for the owner (P5-6). Claude Code never runs these steps.

**Cadence:** quarterly (access reviews), and whenever the auditor asks for a sample.
**Where results go:** straight to Vanta (or the auditor's portal). Never commit them, never paste
them into an issue or PR, and never attach them to a GitHub artifact.

## 1. Download the weekly bundle (any machine)
1. GitHub → Actions → **Evidence** → latest run → artifact `evidence-<run id>`.
2. Unzip and verify: `sha256sum -c SHA256SUMS` (every line `OK`).
3. Upload the folder to Vanta. Record the `manifest.json` sha256 from the run log with the upload.
4. On demand: Actions → Evidence → **Run workflow** (optionally a different audit window).

## 2. Repository access and branch protection (admin token, production, owner)
The workflow's token is read-only, so `github/access.json` and `github/branch-protection.json` mark
collaborators and classic protection as `available: false`. Export them with your own admin login:
```bash
gh auth status   # signed in as a repository admin
R=Pani-Digital-Services-LLC/yayatoh   # the repository, as on GitHub
gh api "repos/$R/collaborators?affiliation=all&per_page=100" \
  --jq '[.[] | {login, role_name, admin: .permissions.admin, push: .permissions.push}]' > collaborators.json
gh api "repos/$R/branches/main/protection" > branch-protection.json
gh api "repos/$R/rulesets" > rulesets.json
```
Review: every collaborator is someone on the approved list; nobody has admin who shouldn't;
`main` requires PRs, the CI checks and at least one approval, with force pushes off.

## 3. Quarterly access review (production, owner)
For each system, export or screenshot the member list with roles and MFA state, compare against
the approved list, remove anyone who shouldn't be there, then record "reviewed on <date>, changes:
…" in Vanta. Leavers: also rotate what they could read ([key-rotation.md](key-rotation.md)).

| System | Where to find the member list |
|---|---|
| GitHub | Step 2 (`collaborators.json`) and the organization's People page |
| Doppler | Workplace → Team (members, roles), and each project's access |
| Vercel | Team → Settings → Members |
| Neon | Organization → People; project → Roles (database roles: `app_user`, `migrator`, `platform_reader`, `ledger_writer`) |
| Fly.io | Organization → Members; `fly tokens list` for deploy tokens |
| AWS | IAM → Credential report (download CSV) and IAM Identity Center users |
| Cloudflare | Manage account → Members |
| Stripe | Settings → Team and security |
| Upstash, Ably, Sentry, Axiom, Twilio | Each console's team or members page |
| Staff console | The staff list (D10): compare `platform.staff` members with the approved list; see step 4 for their reads |

## 4. Staff reads and audit-log samples (production, owner)
Staff reads through `platform_reader` are in `platform.access_log`. Review a quarter of it in the
staff console, or with a read-only query on a Neon read replica or branch.

When the auditor asks for audit-log samples of specific customer orgs, run the reviewed sampler
**on your machine** with production credentials from Doppler. It reads through the same audited
path as CI (one `platform_reader` lookup, then each org's Activity log under its own RLS, with
only the allowlisted fields), and stamps the file `production-owner-run`, which the CI bundle
builder refuses to take:
```bash
doppler run --project <project> --config <production config> -- \
  env EVIDENCE_PRODUCTION_READ=owner-approved \
  pnpm --filter @yayatoh/worker audit-sample -- \
    --production --orgs <slug-1>,<slug-2> --per-org 25 --out ~/evidence/audit-samples-$(date -u +%F).json
```
Check the file before uploading it (it holds actors as `user:<id>`, actions, targets and scalar
details; no names, emails or free text). Upload it to Vanta; delete the local copy afterwards.

## 5. Things only the owner signs or buys
Tracked in `docs/owner-inbox.md` under "Enterprise readiness (M5.11)": Vanta, the auditor, the
pen test, the VPAT sign-off, the DPF self-certification and each policy's approval.
