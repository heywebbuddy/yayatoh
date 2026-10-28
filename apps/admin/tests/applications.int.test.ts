import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitApplication } from '@yayatoh/applications';
import { assignOrganizationPlanCommand } from '@yayatoh/billing';
import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { readDevMailbox } from '@yayatoh/notifications';
import { signUpOrganization, signupCodeInfo } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  addApplicationNote,
  approveApplication,
  assignApplication,
  getApplication,
  listApplications,
  markInReview,
  resendInvitation,
  sendDecision,
} from '../src/server/applications.ts';
import type { Staff } from '../src/server/staff.ts';

const admin = adminClient();
const mailbox = mkdtempSync(join(tmpdir(), 'apps-mailbox-'));
process.env.DEV_MAILBOX_DIR = mailbox;
const staffId = uuidv7();
const staff = {
  userId: staffId,
  name: 'Test Staff',
  email: 'staff@example.test',
  role: 'admin',
  actor: `staff:${staffId}`,
  can: () => true,
  ctx: () => createCtx(),
} as unknown as Staff;

beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(async () => {
  await admin.end?.();
  await closePools();
});

const form = (email: string, org = 'Harbor Weddings') => ({
  kind: 'apply',
  orgName: org,
  orgType: 'company',
  country: 'in',
  website: 'https://harbor.example',
  contactName: 'Asha Rao',
  contactEmail: email,
  eventTypes: ['wedding', 'gala'],
  eventsPerYear: '6-20',
  expectedTickets: '500-5000',
  planInterest: 'pro',
  whiteLabel: false,
  locale: 'en',
});

/** The signup code the invitation email carried (the only place it ever exists). */
function codeSentTo(email: string): string {
  const mails = readDevMailbox({ to: email }, mailbox) as { text: string; subject: string }[];
  const last = mails.find((m) => m.subject.includes('approved'));
  const code = /code=([A-Z0-9-]+)/.exec(last?.text ?? '')?.[1];
  if (!code) throw new Error('no invitation in the mailbox');
  return code;
}

const person = () => createCtx({ actor: { type: 'user', userId: uuidv7() } });

describe('organizer applications: apply → review → approve → signup', () => {
  const email = `asha-${uuidv7().slice(-8)}@harbor.example`;
  let id = '';

  it('stores an application once; a repeat while it is open is the same record', async () => {
    const a = await submitApplication(form(email));
    expect(a.duplicate).toBe(false);
    id = a.id;
    expect(await submitApplication(form(email))).toEqual({ id, duplicate: true });
    await expect(submitApplication({ ...form(email), contactEmail: 'nope' })).rejects.toThrow();
    const { rows } = await listApplications(staff, { q: email });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'new', country: 'IN', contactEmail: email });
  });

  it('the public connection cannot read or change applications directly', async () => {
    await expect(
      withoutTenant((tx) => tx.execute(sql`select * from applications.applications`)),
    ).rejects.toThrow();
    await expect(
      withoutTenant((tx) =>
        tx.execute(sql`select applications.set_status(${id}::uuid, 'in_review', 'staff:x', '')`),
      ),
    ).rejects.toThrow();
  });

  it('staff assign, note and take it; every step is in the audit log', async () => {
    await assignApplication(staff, id, staff.actor);
    await addApplicationNote(staff, id, 'Looks real: checked the website.');
    await markInReview(staff, id);
    const d = await getApplication(staff, id);
    expect(d?.application).toMatchObject({ status: 'in_review', assignedTo: staff.actor });
    expect(d?.notes).toHaveLength(1);
    expect(d?.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['submitted', 'assigned', 'note_added', 'status_changed']),
    );
  });

  it('needs info sends the edited email and changes the status; a failed state change is refused', async () => {
    await sendDecision(staff, id, 'needs_info', {
      subject: 'More details please',
      body: 'Tell us your venue size.',
    });
    expect((await getApplication(staff, id))?.application.status).toBe('needs_info');
    const sent = readDevMailbox({ to: email }, mailbox) as { subject: string }[];
    expect(sent.map((m) => m.subject)).toContain('More details please');
    await expect(markInReview(staff, id)).resolves.toBeUndefined();
    await expect(markInReview(staff, id)).rejects.toThrow();
  });

  it('approve creates a one-time code tied to the email and plan; signup lands the org on that plan', async () => {
    const r = await approveApplication(staff, id, { plan: 'launch_standard', note: 'Welcome' });
    expect(r.emailSent).toBe(true);
    const code = codeSentTo(email);
    expect(await signupCodeInfo(code)).toMatchObject({
      valid: true,
      boundEmail: email,
      planKey: 'launch_standard',
    });

    const base = {
      code,
      slug: `harbor-${uuidv7().slice(-8)}`,
      name: 'Harbor Weddings',
      defaultProfile: 'wedding',
      acceptTerms: true,
    };
    // another person's verified email cannot use it, and a code with no email cannot either
    await expect(
      signUpOrganization(person(), { ...base, claimEmail: 'someone@else.example' }, ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'invalid_code' } });
    await expect(signUpOrganization(person(), base, ports)).rejects.toMatchObject({
      code: 'validation_failed',
    });

    const ctx = person();
    const org = await signUpOrganization(ctx, { ...base, claimEmail: email.toUpperCase() }, ports);
    expect(org.status).toBe('active');
    // the web action applies the approved plan with a system actor right after signup
    const info = { planKey: 'launch_standard' };
    await executeCommand(
      assignOrganizationPlanCommand,
      { planKey: info.planKey, reason: 'organizer application approved' },
      createCtx({ orgId: org.id, actor: { type: 'system', name: 'application' } }),
      ports,
    );
    const [plan] = await admin`select plan_key from billing.org_plans where org_id = ${org.id}`;
    expect(plan?.plan_key).toBe('launch_standard');

    // one use only, and the audit log shows the signup
    expect(await signupCodeInfo(code)).toMatchObject({ valid: false });
    await expect(
      signUpOrganization(person(), { ...base, slug: `x-${uuidv7().slice(-8)}`, claimEmail: email }, ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const d = await getApplication(staff, id);
    expect(d?.application.status).toBe('approved');
    expect(d?.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['approved', 'email_sent', 'signed_up']),
    );
    await expect(resendInvitation(staff, id)).rejects.toThrow();
  });

  it('a rejected application can be reopened; an approved one is final', async () => {
    const other = await submitApplication(form(`n-${uuidv7().slice(-8)}@x.example`, 'Other Org'));
    await sendDecision(staff, other.id, 'rejected', {
      subject: 'Your application',
      body: 'We cannot open an account now.',
    });
    expect((await getApplication(staff, other.id))?.application.status).toBe('rejected');
    await markInReview(staff, other.id);
    await expect(
      sendDecision(staff, id, 'rejected', { subject: 'Nope nope', body: 'Not allowed after approval.' }),
    ).rejects.toThrow();
  });

  it('resend issues a fresh code and kills the old one', async () => {
    const e2 = `r-${uuidv7().slice(-8)}@x.example`;
    const a = await submitApplication(form(e2, 'Resend Org'));
    await approveApplication(staff, a.id, { plan: 'launch_standard', note: '' });
    const first = codeSentTo(e2);
    await resendInvitation(staff, a.id);
    const second = codeSentTo(e2);
    expect(second).not.toBe(first);
    expect((await signupCodeInfo(first)).valid).toBe(false);
    expect((await signupCodeInfo(second)).valid).toBe(true);
  });
});
