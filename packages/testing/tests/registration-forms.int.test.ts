import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import {
  getFormQuery,
  getRegistrationFormQuery,
  listJobTitlesQuery,
  MAX_RESUME_SENDS,
  publicCompanySuggestions,
  publicRespondent,
  publishFormCommand,
  publishRegistrationFormCommand,
  registrationResumeMailer,
  respondentRef,
  saveRegistrationPageCommand,
  setJobTitlesCommand,
  startRegistrationFormCommand,
} from '@yayatoh/forms';
import { companies, jobTitles, respondents } from '@yayatoh/forms/testing';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, eventKey, memoryNotifier, recentEventsTx } from '@yayatoh/platform';
import { retentionCommand } from '@yayatoh/privacy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, submitRegistrationForm, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let eventId: string;

// Three registration types, as M5.1a will supply them (opaque ids to the forms engine).
const MEMBER = uuidv7();
const STUDENT = uuidv7();
const EXHIBITOR = uuidv7();

/**
 * The fixture path: page 1 for everyone (a student-only question on it), a member page, an
 * exhibitor page, and a workshops page opened by a page-1 answer (cross-page condition).
 */
const DEFINITION = {
  pages: [
    {
      key: 'about',
      title: 'About you',
      fields: [
        { key: 'company', type: 'company', label: 'Company', required: true },
        { key: 'job', type: 'job_title', label: 'Job title' },
        { key: 'workshops', type: 'checkbox', label: 'Joining workshops?' },
        { key: 'school', type: 'short_text', label: 'School', required: true, registrationTypes: [STUDENT] },
      ],
    },
    {
      key: 'membership',
      title: 'Membership',
      registrationTypes: [MEMBER],
      fields: [{ key: 'member_no', type: 'short_text', label: 'Member number', required: true }],
    },
    {
      key: 'booth',
      title: 'Your booth',
      registrationTypes: [EXHIBITOR],
      fields: [
        {
          key: 'booth_size',
          type: 'select',
          label: 'Booth size',
          required: true,
          options: [
            { value: 's', label: 'Small' },
            { value: 'l', label: 'Large' },
          ],
        },
        { key: 'access', type: 'short_text', label: 'Access needs', sensitive: true },
      ],
    },
    {
      key: 'workshops_page',
      title: 'Workshops',
      showIf: { '==': [{ var: 'workshops' }, true] },
      fields: [
        {
          key: 'track',
          type: 'select',
          label: 'Track',
          required: true,
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        {
          key: 'share_email',
          type: 'consent',
          label: 'Exhibitors may receive my email',
          consent: { term: 'exhibitor_email_sharing', version: 1 },
        },
      ],
    },
  ],
};

const viewer = () => userCtx(a.viewerId, a.org.id);
const anon = (orgId = a.org.id, now?: Date): Ctx => createCtx({ orgId, ...(now ? { now } : {}) });
const eventName = async () => 'Summit';
const idOf = async (token: string) => {
  const ref = await respondentRef(token);
  if (!ref) throw new Error('unknown respondent link');
  return ref.respondentId;
};

async function start(type: string, who: string, onEvent = eventId, orgId = a.org.id) {
  const r = await executeCommand(
    startRegistrationFormCommand,
    { eventId: onEvent, registrationTypeId: type, name: who, email: `${who.toLowerCase()}@example.test` },
    anon(orgId),
    ports,
  );
  return r.token;
}

const save = (
  token: string,
  pageKey: string,
  answers: Record<string, unknown>,
  intent: 'next' | 'back' | 'stay' | 'email' = 'next',
  ctx = anon(),
) => executeCommand(saveRegistrationPageCommand, { token, pageKey, answers, intent }, ctx, ports);

const submit = (token: string, pageKey: string, answers: Record<string, unknown>, ctx = anon()) =>
  executeCommand(submitRegistrationForm, { token, pageKey, answers }, ctx, ports);

const view = async (token: string, now?: Date) => {
  const v = await publicRespondent(token, { eventName, ...(now ? { now } : {}) });
  if (!v) throw new Error('no respondent');
  return v;
};

/**
 * Walks the whole path as the browser does: "Continue" saves the page and moves on; on the last
 * page (the server returns the same page) it submits. Returns the page keys seen.
 */
async function walk(token: string, answers: Record<string, Record<string, unknown>>) {
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) {
    const key = (await view(token)).page?.key ?? '';
    seen.push(key);
    const moved = await save(token, key, answers[key] ?? {});
    if (moved.pageKey === key) {
      await submit(token, key, {});
      return seen;
    }
  }
  throw new Error('path did not end');
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Registration Summit',
      timezone: 'UTC',
      startsAt: '2031-05-01T09:00:00Z',
      endsAt: '2031-05-02T17:00:00Z',
      profile: 'conference',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  await executeCommand(publishRegistrationFormCommand, { eventId, definition: DEFINITION }, a.ctx(), ports);
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

describe('registration form definitions (M5.1b)', () => {
  it('publishes immutable versions; viewers read but cannot edit; the module key gates it', async () => {
    const v = await executeQuery(getRegistrationFormQuery, { eventId }, viewer(), ports);
    expect(v?.definition.pages.map((p) => p.key)).toEqual(['about', 'membership', 'booth', 'workshops_page']);
    await expect(
      executeCommand(publishRegistrationFormCommand, { eventId, definition: DEFINITION }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = await executeCommand(
      createEventCommand,
      { name: 'Gated', timezone: 'UTC', startsAt: '2031-06-01T09:00:00Z', endsAt: '2031-06-01T17:00:00Z' },
      b.ctx(),
      ports,
    );
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'registration', effect: 'revoke', reason: 'M5.1b gate test' },
      systemCtx(b.org.id),
      ports,
    );
    await expect(
      executeCommand(
        publishRegistrationFormCommand,
        { eventId: other.id, definition: DEFINITION },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'module_not_enabled' });
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'registration', effect: 'grant', reason: 'M5.1b gate test done' },
      systemCtx(b.org.id),
      ports,
    );
  });

  it('refuses a publish from a stale version (two editors never overwrite each other)', async () => {
    const current = await executeQuery(getRegistrationFormQuery, { eventId }, a.ctx(), ports);
    const v = current?.version ?? 0;
    const next = await executeCommand(
      publishRegistrationFormCommand,
      { eventId, definition: DEFINITION, expectedVersion: v },
      a.ctx(),
      ports,
    );
    expect(next.version).toBe(v + 1);
    await expect(
      executeCommand(
        publishRegistrationFormCommand,
        { eventId, definition: DEFINITION, expectedVersion: v },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stale_version' } });
  });

  it('refuses invalid definitions (conditions on later questions, required consent)', async () => {
    await expect(
      executeCommand(
        publishRegistrationFormCommand,
        {
          eventId,
          definition: {
            pages: [
              { key: 'one', title: 'One', showIf: { var: 'later' }, fields: [] },
              { key: 'two', title: 'Two', fields: [{ key: 'later', type: 'checkbox', label: 'L' }] },
            ],
          },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('leaves the existing kinds alone: their commands refuse the registration kind', async () => {
    await expect(
      executeCommand(
        publishFormCommand,
        {
          kind: 'registration',
          subjectType: 'event',
          subjectId: eventId,
          definition: { fields: [] },
        } as never,
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // The event's checkout questions are a separate form, untouched by the registration form.
    expect(
      await executeQuery(
        getFormQuery,
        { kind: 'checkout_questions', subjectType: 'event', subjectId: eventId },
        a.ctx(),
        ports,
      ),
    ).toBeNull();
  });
});

describe('the fixture path for three registration types', () => {
  it('shows and validates exactly the right pages for each type', async () => {
    const base = { about: { company: 'Acme', job: 'Engineer', workshops: true } };
    const member = await walk(await start(MEMBER, 'Mia'), {
      ...base,
      membership: { member_no: 'M-7' },
      workshops_page: { track: 'a' },
    });
    expect(member).toEqual(['about', 'membership', 'workshops_page']);
    const exhibitor = await walk(await start(EXHIBITOR, 'Eli'), {
      about: { company: 'Acme', workshops: false },
      booth: { booth_size: 'l', access: 'Ramp' },
    });
    expect(exhibitor).toEqual(['about', 'booth']);
    const student = await walk(await start(STUDENT, 'Sam'), {
      about: { company: 'State U', school: 'State U', workshops: true },
      workshops_page: { track: 'b' },
    });
    expect(student).toEqual(['about', 'workshops_page']);
  });

  it('sends only the page on the path, with only this type’s questions', async () => {
    const token = await start(MEMBER, 'Pia');
    const v = await view(token);
    expect(v).toMatchObject({ state: 'open', step: 1, steps: 2, first: true, last: false });
    expect(v.page?.fields.map((f) => f.key)).toEqual(['company', 'job', 'workshops']);
    expect(JSON.stringify(v)).not.toContain('school');
    expect(JSON.stringify(v)).not.toContain('booth');
    expect(JSON.stringify(v)).not.toContain(STUDENT);
    // A page-1 answer opens the workshops page: the step count follows.
    await save(token, 'about', { company: 'Acme', workshops: true });
    expect(await view(token)).toMatchObject({ step: 2, steps: 3, page: { key: 'membership' } });
  });

  it('enforces required questions on visible pages when leaving them', async () => {
    const token = await start(STUDENT, 'Req');
    await expect(save(token, 'about', { company: 'Acme' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'required', field: 'school' },
    });
    // Saving without moving on keeps the draft, required or not.
    await save(token, 'about', { company: 'Acme' }, 'stay');
    await expect(submit(token, 'about', {})).rejects.toMatchObject({ details: { field: 'school' } });
  });
});

describe('server authority', () => {
  it('rejects answers on hidden pages and questions, naming the question', async () => {
    const token = await start(EXHIBITOR, 'Hid');
    // The member page is not on an exhibitor's path.
    await expect(save(token, 'about', { company: 'Acme', member_no: 'M-1' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'hidden_answer', field: 'member_no' },
    });
    // The workshops page is hidden while "workshops" is not checked.
    await expect(
      submit(token, 'about', { company: 'Acme', workshops: false, booth_size: 's', track: 'a' }),
    ).rejects.toMatchObject({ details: { reason: 'hidden_answer', field: 'track' } });
    // A student-only question on a visible page.
    await expect(save(token, 'about', { company: 'Acme', school: 'X' })).rejects.toMatchObject({
      details: { reason: 'hidden_answer', field: 'school' },
    });
    // A page that is not on the path cannot be saved.
    await expect(save(token, 'membership', {})).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'page_not_on_path' },
    });
    await expect(save(token, 'about', { nope: 1 })).rejects.toMatchObject({
      details: { reason: 'unknown_question', field: 'nope' },
    });
    // Nothing was stored by the refused calls.
    const [row] = await admin<{ answers: object }[]>`
      select answers from forms.respondents where id = ${await idOf(token)}`;
    expect(row?.answers).toEqual({});
  });

  it('drops the person’s own stored answers that fell off the path after they changed an earlier answer', async () => {
    const token = await start(MEMBER, 'Chg');
    await save(token, 'about', { company: 'Acme', workshops: true });
    await save(token, 'membership', { member_no: 'M-2' });
    await save(token, 'workshops_page', { track: 'a' }, 'stay');
    // Back on page 1, workshops unticked: the stored track answer is no longer on the path.
    await save(token, 'about', { workshops: false }, 'stay');
    await submit(token, 'membership', {});
    const [row] = await admin<{ answers: Record<string, unknown> }[]>`
      select fr.answers from forms.form_responses fr
      where fr.respondent_type = 'form_respondent' and fr.respondent_id = ${await idOf(token)}`;
    expect(row?.answers).toEqual({ company: 'Acme', workshops: false, member_no: 'M-2' });
  });

  it('keeps sensitive answers in the KeyVault envelope, in the draft and the response', async () => {
    const token = await start(EXHIBITOR, 'Sec');
    await save(token, 'about', { company: 'Acme' });
    await save(token, 'booth', { booth_size: 's', access: 'Step-free please' }, 'stay');
    const id = await idOf(token);
    const [draft] = await admin<{ answers: object; sensitive_ciphertext: string | null }[]>`
      select answers, sensitive_ciphertext from forms.respondents where id = ${id}`;
    expect(JSON.stringify(draft?.answers)).not.toContain('Step-free');
    expect(draft?.sensitive_ciphertext).toBeTruthy();
    expect(draft?.sensitive_ciphertext).not.toContain('Step-free');
    // The person sees their own answer again when they come back.
    expect((await view(token)).values).toMatchObject({ access: 'Step-free please' });
    await submit(token, 'booth', {});
    const [resp] = await admin<{ answers: object; sensitive_ciphertext: string | null }[]>`
      select answers, sensitive_ciphertext from forms.form_responses
      where respondent_type = 'form_respondent' and respondent_id = ${id}`;
    expect(resp?.answers).toEqual({ company: 'Acme', booth_size: 's' });
    expect(resp?.sensitive_ciphertext).toBeTruthy();
    const [emptied] = await admin<{ answers: object; sensitive_ciphertext: string | null }[]>`
      select answers, sensitive_ciphertext from forms.respondents where id = ${id}`;
    expect(emptied).toEqual({ answers: {}, sensitive_ciphertext: null });
  });

  it('pins a respondent to the version they started on', async () => {
    const token = await start(MEMBER, 'Pin');
    const renamed = structuredClone(DEFINITION);
    (renamed.pages[0] as { title: string }).title = 'About you (v2)';
    const { version } = await executeCommand(
      publishRegistrationFormCommand,
      { eventId, definition: renamed },
      a.ctx(),
      ports,
    );
    expect((await view(token)).page?.title).toBe('About you');
    expect((await view(await start(MEMBER, 'Newer'))).page?.title).toBe('About you (v2)');
    await save(token, 'about', { company: 'Acme' });
    await submit(token, 'membership', { member_no: 'M-9' });
    const [row] = await admin<{ version: number }[]>`
      select v.version from forms.form_responses r join forms.form_versions v on v.id = r.form_version_id
      where r.respondent_type = 'form_respondent' and r.respondent_id = ${await idOf(token)}`;
    expect(row?.version).toBe(version - 1);
  });
});

describe('consent questions and the ledger', () => {
  const ledger = (email: string) => admin<
    { channel: string; purpose: string; status: string; version: number | null; evidence: string }[]
  >`
    select k.channel, k.purpose, k.status, k.version, k.evidence from crm.consents k
    join crm.contacts c on c.id = k.contact_id
    where c.org_id = ${a.org.id} and c.email_norm = ${email}`;

  it('records a checked box with the term version; an unchecked box records nothing', async () => {
    const yes = await start(MEMBER, 'Consenter');
    await save(yes, 'about', { company: 'Acme', workshops: true });
    await save(yes, 'membership', { member_no: 'M-3' });
    await submit(yes, 'workshops_page', { track: 'a', share_email: 'on' });
    const rows = await ledger('consenter@example.test');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'email',
      purpose: 'exhibitor_sharing',
      status: 'granted',
      version: 1,
    });
    expect(rows[0]?.evidence).toMatch(/^registration_form:[0-9a-f-]{36}:v\d+:share_email$/);
    // Never marketing consent.
    const [profile] = await admin<{ email_consent: string }[]>`
      select p.email_consent from crm.contact_profile p join crm.contacts c on c.id = p.contact_id
      where c.org_id = ${a.org.id} and c.email_norm = 'consenter@example.test'`;
    expect(profile?.email_consent ?? 'none').toBe('none');

    const no = await start(MEMBER, 'Decliner');
    await save(no, 'about', { company: 'Acme', workshops: true });
    await save(no, 'membership', { member_no: 'M-4' });
    await submit(no, 'workshops_page', { track: 'a', share_email: false });
    expect(await ledger('decliner@example.test')).toEqual([]);
  });
});

describe('save and resume', () => {
  it('emails the respondent their own link once per request, capped', async () => {
    const token = await start(MEMBER, 'Resumer');
    await save(token, 'about', { company: 'Acme' }, 'email');
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['form.resume_requested'], 3_600_000),
    );
    const { notifier, sent } = memoryNotifier();
    const mailer = registrationResumeMailer({ notifier, appOrigin: 'https://app.test', eventName });
    for (const e of events) if (mailer.events.includes(eventKey(e))) await consumeEvent(mailer, e);
    const mine = sent.filter((m) => m.to.email === 'resumer@example.test');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: 'forms.resume',
      params: { url: `https://app.test/registration-form/${token}` },
    });
    // The link resumes on the saved page with the saved answers.
    expect(await view(token)).toMatchObject({ page: { key: 'about' }, values: { company: 'Acme' } });
    for (let i = 1; i < MAX_RESUME_SENDS; i++) await save(token, 'about', {}, 'email');
    await expect(save(token, 'about', {}, 'email')).rejects.toMatchObject({
      code: 'rate_limited',
      details: { reason: 'resume_limit' },
    });
  });

  it('refuses forged, expired and used links', async () => {
    const token = await start(MEMBER, 'Linky');
    const forged = `${token.split('~')[0]}~${'A'.repeat(43)}`;
    expect(await respondentRef(forged)).toBeNull();
    expect(await publicRespondent(forged, { eventName })).toBeNull();
    await expect(save(forged, 'about', {})).rejects.toMatchObject({ code: 'not_found' });
    // Another purpose's token for the same id is not a respondent link.
    expect(await respondentRef(`${uuidv7()}~x`)).toBeNull();

    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await view(token, later)).state).toBe('expired');
    expect((await view(token, later)).page).toBeNull();
    await expect(save(token, 'about', {}, 'stay', anon(a.org.id, later))).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'expired' },
    });

    await save(token, 'about', { company: 'Acme' });
    await submit(token, 'membership', { member_no: 'M-5' });
    expect((await view(token)).state).toBe('submitted');
    await expect(submit(token, 'membership', {})).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'already_submitted' },
    });
  });

  it('purges drafts that expired unsubmitted in the retention pass, never submitted ones', async () => {
    const draft = await start(MEMBER, 'Stale');
    const done = await start(MEMBER, 'Kept');
    await save(done, 'about', { company: 'Acme' });
    await submit(done, 'membership', { member_no: 'M-6' });
    const later = new Date(Date.now() + 15 * 86_400_000);
    const r = await executeCommand(retentionCommand, {}, { ...systemCtx(a.org.id), now: later }, ports);
    expect(r.registrationDrafts).toBeGreaterThanOrEqual(1);
    expect(await respondentRef(draft)).toBeNull();
    expect(await respondentRef(done)).not.toBeNull();
  });
});

describe('job titles and company suggestions', () => {
  it('keeps an org-editable job title list; viewers cannot edit it', async () => {
    await executeCommand(setJobTitlesCommand, { titles: ['CEO', 'Engineer', 'Designer'] }, a.ctx(), ports);
    expect(await executeQuery(listJobTitlesQuery, {}, viewer(), ports)).toEqual([
      'CEO',
      'Engineer',
      'Designer',
    ]);
    await expect(
      executeCommand(setJobTitlesCommand, { titles: ['Hacker'] }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(setJobTitlesCommand, { titles: ['CEO', 'ceo'] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // The respondent's page carries the list when it has a job title question.
    expect((await view(await start(MEMBER, 'Jobby'))).jobTitles).toEqual(['CEO', 'Engineer', 'Designer']);
    // Free text ("other") is accepted.
    const t = await start(EXHIBITOR, 'Other');
    await save(t, 'about', { company: 'Acme', job: 'Chief Happiness Officer' });
  });

  it('suggests a company only once two respondents named it, per org', async () => {
    const name = `Zephyr ${Date.now()}`;
    const one = await start(EXHIBITOR, 'Zed');
    await save(one, 'about', { company: name });
    await submit(one, 'booth', { booth_size: 's' });
    expect(await publicCompanySuggestions(a.org.id, 'zephyr')).not.toContain(name);
    const two = await start(EXHIBITOR, 'Zoe');
    await save(two, 'about', { company: ` ${name.toUpperCase()} ` });
    await submit(two, 'booth', { booth_size: 's' });
    expect(await publicCompanySuggestions(a.org.id, 'zephyr')).toContain(name);
    expect(await publicCompanySuggestions(a.org.id, 'z')).toEqual([]);
    expect(await publicCompanySuggestions(b.org.id, 'zephyr')).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('another org cannot use, read or answer a respondent link', async () => {
    const token = await start(MEMBER, 'Iso');
    // The link resolves to its own org only.
    expect((await respondentRef(token))?.orgId).toBe(a.org.id);
    await expect(save(token, 'about', { company: 'X' }, 'stay', anon(b.org.id))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(submit(token, 'about', {}, anon(b.org.id))).rejects.toMatchObject({ code: 'not_found' });
    // B cannot start A's form (the event is not B's).
    await expect(start(MEMBER, 'Cross', eventId, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    // Under B's RLS, A's respondents, job titles and companies do not exist.
    const seen = await withTenant(userCtx(b.ownerId, b.org.id), async (tx) => ({
      respondents: (await tx.select().from(respondents)).filter((r) => r.orgId === a.org.id).length,
      jobTitles: (await tx.select().from(jobTitles)).filter((r) => r.orgId === a.org.id).length,
      companies: (await tx.select().from(companies)).filter((r) => r.orgId === a.org.id).length,
    }));
    expect(seen).toEqual({ respondents: 0, jobTitles: 0, companies: 0 });
  });
});
