# applications (tier 1)

Organizer applications and demo requests from the landing page `/for-organizers`, and the staff queue that reviews them. Owns Postgres schema `applications`.

**Invariants**
- **Global, private tables.** `applications`, `notes` and `events` have no tenant (an applicant has no organization yet) and no `app_user` privileges. The public form writes only through the SECURITY DEFINER `applications.submit` (and `applications.log_email` for the applicant's confirmation); staff (platform_reader, `apps/admin`) read the tables and change them only through `applications.set_status`, `assign`, `add_note`, `log_email`, `approve` and `reissue`, each needing a `staff:` actor.
- **One open record per sender.** The same email asking for the same kind again within seven days while the first is `new`, `in_review` or `needs_info` returns that record (`duplicate: true`); nothing is stored twice and the page shows the same confirmation.
- **Status machine** (`canTransition`, enforced again in SQL): `new` → `in_review` / `needs_info` / `rejected` / `approved`; `in_review` and `needs_info` → `approved` / `rejected` / the other; `rejected` → `in_review` (reopen); `approved` is final. `approved` is reached only through `applications.approve`, never `set_status`.
- **Approve = a signup code, in one transaction.** `applications.approve` locks the application, checks the plan exists in `billing.plans`, inserts one single-use `platform.signup_codes` row tied to the applicant's email (`bound_email`) and plan (`plan_key`), and marks the application approved (a CHECK ties `status = 'approved'` to a code). Only the hash is stored; the console makes the code and mails the link. `reissue` revokes an unused code and issues a new one.
- **Bound codes.** A code with `bound_email` is refused by the one-argument `platform.claim_signup_code`; it is claimed only through `platform.claim_signup_code_for(hash, email)` with the signed-in person's verified email, which returns the plan and writes `signed_up` to the audit log. A failed signup rolls the claim back.
- **Audit.** Every submit, status change, assignment, note, email and approval is a row in `applications.events` (append-only) and, for staff, a `platform.access_log` row written before the console touches the data.
- **Personal data.** Applicant names, emails and phone numbers are visible only to platform staff with the `applications` capability (admin and support); notes are internal and never mailed.
- **Abuse.** The landing page form requires the human check where a provider exists, the `organizerApplication` rate limit (device, IP and email) and a honeypot; the confirmation goes to the applicant (in their language) and an alert to `APPLICATIONS_ALERT_EMAIL` (falling back to `PLATFORM_CONTACT_EMAIL`).

**Public surface:** `.` (input schema and rules, `submitApplication`, email helpers).
