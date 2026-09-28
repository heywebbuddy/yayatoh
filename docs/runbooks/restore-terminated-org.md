# Restore a terminated organization (un-terminate)

Terminating an org (M1.3f, staff console → tenant → *Organization status* → *Terminate*) is final
from the console's ordinary status forms. When a termination turns out to be a mistake — the wrong
org, a chargeback dispute that was settled, a fraud flag that was cleared — this runbook puts the
org back. It is **not** a way to reopen an org its owners asked to close, or one whose data was
erased (a DSAR or retention matter, M1.14c): then stop and ask the owner of the platform.

**Who:** a staff member with the **admin** role, after the platform owner has approved the
request in writing (ticket or email). **Never by SQL:** the only write is the reviewed command
`tenancy.restoreOrg`, run from the staff console. It is audited, needs a reason and a fresh
confirmation of the staff member's identity (step-up), and reverses only what termination did.

## What termination did, and what restoring reverses

| Termination did | Restore does |
|---|---|
| Set `tenancy.organizations.status` to `terminated` and wrote an `org_status_changes` row (`from` = the status before) | Sets the status back to that recorded `from` (active, limited or **suspended**) and writes its own row (`restore`, `terminated` → `from`) |
| Audit row `org.status_change` (`terminate`) in the org's log | Audit row `org.status_change` (`restore`, with the termination's id and the note) |
| `org.status_changed@1`: the listings projector dropped the org's marketplace listings; owners were told | `org.status_changed@1` (action `restore`): the projector **rebuilds** the listings from the org's events when the org is live again; owners are told (the note is never shown) |
| Public pages, `/v1/public`, the widget, checkout, API keys, door devices, domain re-checks and member access stopped **because they check the status** | They work again on the next request (tenant hosts may take up to 30 s: the proxy's host cache) |

Termination deleted nothing and revoked nothing, so restore has nothing else to put back and
**changes nothing else**: kill switches (pause checkout / publishing / messaging), payout holds,
API keys, devices, domains, members, fee and entitlement overrides stay exactly as they are. An org
that was **suspended** when it was terminated comes back **suspended**; reactivate it afterwards
with the ordinary form only if the suspension's own reason is resolved.

## Before you start
1. **The approval.** A written approval from the platform owner that names the org (slug) and the
   reason. Put its reference (ticket id) in the reason field.
2. **(production, admin staff)** Open the org in the staff console (`admin.yayatoh.com` → Tenants
   → search the slug). Check:
   - Status is **Terminated**, and the history shows the termination (who, when, note). If the
     history has **no termination row** (for example an org terminated by a data migration), the
     command refuses (`no_termination_record`): nothing says what to restore. Stop and escalate;
     do not edit the database.
   - The termination's note: does the approval address it?
   - Kill switches and payout holds: decide with the owner whether any should stay on after the
     restore (they are not touched by it).
3. **Data still there?** If a DSAR erasure or the retention job ran for this org after the
   termination, stop: restoring would bring back an org with missing data. (Retention skips
   terminated orgs, so this only happens by an explicit erasure.)

## Steps
1. **(production, admin staff)** Tenant page → *Organization status* → **Restore this
   organization**.
2. Fill in:
   - **Reason:** the approval reference and a short why (3–500 characters). Kept in the org's
     history and audit log; never shown to the organizer.
   - **The org's address** (its slug), typed exactly, like for terminate.
   - **Confirm it's you:** your password, or the code from your authenticator app if you use one.
3. Press **Restore organization**. The console writes a platform access-log row first
   (`staff console: restore organization <slug>: <reason>`), then runs the command, then asks
   the web app to drop the org's cached public pages.
4. Expect: "Organization restored." and the status the org had before termination. Refusals:
   - *Confirm it's you* failed → wrong password/code (5 wrong tries lock step-up for a while).
   - *Type the organization's address* → the slug didn't match.
   - `invalid_state` → someone else already restored it (reload), or no termination is recorded.

## Verify
- Staff console: status and history show the `restore` row with your name and note.
- **(production, admin staff)** Access log (staff console → Access log): the restore line.
- The org's own **Activity** log (as the org's owner, or through the staff console's "Act as a
  member", which is allowed again for a live or suspended org): an `org.status_change` row.
- If restored to active or limited: the organizer page `/o/<slug>` on the marketplace, an event
  page, the tenant site and `/v1/public/events/<slug>` answer 200; the marketplace search lists
  the events after the worker's projector has run (seconds).
- The owners received the "back online" notice (in-app and email).

## Undo
Terminate again from the console (reason: "restore reverted: …"). Both changes stay in the
history.

## Review checklist (for the PR that changes this runbook)
- [ ] Restore still only reverses the status (no new side effects of termination since M1.3f;
      check `org.status_changed@1` subscribers and every `status = 'terminated'` check).
- [ ] The command still needs a platform actor, a reason and a fresh staff step-up.
- [ ] `packages/testing/tests/org-restore.int.test.ts` and `apps/admin/e2e/tenant-restore.spec.ts`
      still pass.
