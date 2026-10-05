import { describe, expect, it } from 'vitest';
import {
  changeDiff,
  changedValues,
  isOverdue,
  missingRecipients,
  PRE_DUE_MS,
  PROFILE_FIELDS,
  preDueKey,
  preDueReminderAt,
  SESSION_FIELDS,
  staleFields,
} from '../src/domain/portal.ts';

describe('change-approval diff (M5.3a)', () => {
  const base = {
    name: 'Ana Ruiz',
    title: 'CTO',
    company: 'Acme',
    bio: 'Old bio',
    links: [{ label: 'Site', url: 'https://a.test' }],
  };

  it('lists only the fields that change, in field order', () => {
    const proposed = { ...base, bio: 'New bio', links: [{ label: 'Site', url: 'https://b.test' }] };
    expect(changeDiff(PROFILE_FIELDS, base, proposed)).toEqual([
      { field: 'bio', before: 'Old bio', after: 'New bio' },
      {
        field: 'links',
        before: [{ label: 'Site', url: 'https://a.test' }],
        after: [{ label: 'Site', url: 'https://b.test' }],
      },
    ]);
    expect(changedValues(PROFILE_FIELDS, base, proposed)).toEqual({
      bio: 'New bio',
      links: [{ label: 'Site', url: 'https://b.test' }],
    });
    expect(changeDiff(PROFILE_FIELDS, base, base)).toEqual([]);
  });

  it('treats a cleared field as a change and ignores fields not proposed or unknown', () => {
    expect(changeDiff(PROFILE_FIELDS, base, { title: null })).toEqual([
      { field: 'title', before: 'CTO', after: null },
    ]);
    expect(changeDiff(SESSION_FIELDS, { title: 'A', description: '' }, { bio: 'x' })).toEqual([]);
    // Link order matters (it is the order shown).
    const two = [
      { label: 'A', url: 'https://a.test' },
      { label: 'B', url: 'https://b.test' },
    ];
    expect(changeDiff(PROFILE_FIELDS, { links: two }, { links: [...two].reverse() })).toHaveLength(1);
  });

  it('flags a proposal as stale when the organizer changed a proposed field since', () => {
    const proposed = { bio: 'Speaker bio' };
    expect(staleFields(PROFILE_FIELDS, base, proposed, base)).toEqual([]);
    expect(staleFields(PROFILE_FIELDS, base, proposed, { ...base, bio: 'Organizer edit' })).toEqual(['bio']);
    // An organizer edit to a field the speaker did not touch is fine.
    expect(staleFields(PROFILE_FIELDS, base, proposed, { ...base, company: 'Other' })).toEqual([]);
  });
});

describe('"remind whoever is missing X"', () => {
  const assignees = [
    { id: 'a1', subjectId: 's1', status: 'done' as const },
    { id: 'a2', subjectId: 's2', status: 'open' as const },
    { id: 'a3', subjectId: 's3', status: 'open' as const },
    { id: 'a4', subjectId: 's4', status: 'open' as const },
  ];
  const contacts = [
    { id: 'c1', subjectId: 's1', email: 'one@x.test' },
    { id: 'c2', subjectId: 's2', email: 'two@x.test' },
    { id: 'c2b', subjectId: 's2', email: 'two@x.test' },
    { id: 'c4', subjectId: 's4', email: 'four@x.test' },
    { id: 'c4b', subjectId: 's4', email: 'assistant@x.test' },
    { id: 'c9', subjectId: 's9', email: 'nine@x.test' },
  ];

  it('reaches exactly the open assignees, once per address, and names the unreachable', () => {
    const plan = missingRecipients(assignees, contacts);
    expect(plan.recipients.map((r) => `${r.assigneeId}:${r.accountId}`)).toEqual([
      'a2:c2',
      'a4:c4',
      'a4:c4b',
    ]);
    expect(plan.unreachable).toEqual(['s3']);
    // Nobody who completed it, nobody outside the task.
    expect(plan.recipients.some((r) => r.subjectId === 's1' || r.subjectId === 's9')).toBe(false);
  });

  it('sends nothing when everyone is done', () => {
    const done = assignees.map((a) => ({ ...a, status: 'done' as const }));
    expect(missingRecipients(done, contacts)).toEqual({ recipients: [], unreachable: [] });
  });
});

describe('reminder timing and overdue', () => {
  const now = new Date('2027-05-01T12:00:00Z');

  it('plans the scheduled reminder 48 h before the due date, at once inside 48 h, never after', () => {
    const due = new Date(now.getTime() + 5 * 86_400_000);
    expect(preDueReminderAt(due, now)?.getTime()).toBe(due.getTime() - PRE_DUE_MS);
    const soon = new Date(now.getTime() + 3_600_000);
    expect(preDueReminderAt(soon, now)).toEqual(now);
    expect(preDueReminderAt(now, now)).toBeNull();
    expect(preDueKey('a', 'c', due)).not.toBe(preDueKey('a', 'c', soon));
  });

  it('is overdue once, when open past the due date', () => {
    const due = new Date(now.getTime() - 1);
    expect(isOverdue({ status: 'open', overdueAt: null }, due, now)).toBe(true);
    expect(isOverdue({ status: 'open', overdueAt: now }, due, now)).toBe(false);
    expect(isOverdue({ status: 'done', overdueAt: null }, due, now)).toBe(false);
    expect(isOverdue({ status: 'open', overdueAt: null }, new Date(now.getTime() + 1), now)).toBe(false);
  });
});
