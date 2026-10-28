import { Alert, Button, Card, Input, PageHeader, Select, StatusDot, Textarea } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { approvablePlans, decisionDefaults, getApplication, reviewers } from '@/server/applications.ts';
import { requireStaff } from '@/server/staff.ts';
import {
  approveAction,
  assignAction,
  needsInfoAction,
  noteAction,
  rejectAction,
  resendAction,
  reviewAction,
} from '../actions.ts';

const DOT = {
  new: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  needs_info: 'warning',
} as const;

const dt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** One application: the facts, the review actions, notes and the audit log. */
export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('applications');
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getApplication(staff, id);
  if (!detail) notFound();
  const t = await getTranslations('applications');
  const { application: a, next } = detail;
  const [people, plans] = await Promise.all([reviewers(staff), approvablePlans(staff)]);
  const can = (s: (typeof next)[number]) => next.includes(s);
  const TIER: Record<string, string> = {
    starter: 'tier_starter',
    pro: 'tier_pro',
    white_label: 'tier_agency',
    enterprise: 'tier_enterprise',
  };
  const defaultPlan = plans.find((p) => p.key === TIER[a.planInterest])?.key ?? plans[0]?.key;
  const facts: [string, string][] = [
    [t('f.contact'), `${a.contactName} <${a.contactEmail}>${a.contactPhone ? ` · ${a.contactPhone}` : ''}`],
    [t('f.type'), `${t(`orgType.${a.orgType}`)} · ${a.country}`],
    [t('f.website'), a.website ?? '—'],
    [t('f.eventTypes'), a.eventTypes.map((e) => t(`eventType.${e}`)).join(', ')],
    [t('f.volume'), `${a.eventsPerYear} / ${a.expectedTickets}`],
    [t('f.plan'), `${t(`plan.${a.planInterest}`)}${a.whiteLabel ? ` · ${t('f.whiteLabel')}` : ''}`],
    [t('f.locale'), a.locale],
    ...(a.preferredTime
      ? ([[t('f.preferred'), `${dt.format(a.preferredTime)} UTC${a.timezone ? ` (${a.timezone})` : ''}`]] as [
          string,
          string,
        ][])
      : []),
    [t('f.message'), a.message ?? '—'],
  ];
  const dec = (k: 'needs_info' | 'rejected') => decisionDefaults(k, a);
  return (
    <Shell staff={staff}>
      <PageHeader
        title={a.orgName}
        description={`${t(`kind.${a.kind}`)} · ${dt.format(a.createdAt)} UTC`}
        actions={<StatusDot status={DOT[a.status]} label={t(`status.${a.status}`)} />}
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.done ? <Alert tone="info" title={t(`done.${sp.done}`)} /> : null}
        {sp.error ? <Alert title={t(`error.${sp.error}`)} /> : null}
      </div>
      <p>
        <Link href="/applications" className="text-body underline underline-offset-2">
          {t('back')}
        </Link>
      </p>
      <Card>
        <dl className="grid gap-x-6 gap-y-2 md:grid-cols-[12rem_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-caption text-ink-2">{k}</dt>
              <dd className="m-0 text-body [overflow-wrap:anywhere] whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('assign.title')}</h2>
        <form action={assignAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
          <Select name="assignee" label={t('assign.label')} defaultValue={a.assignedTo ?? 'none'}>
            <option value="none">{t('unassigned')}</option>
            {people.map((p) => (
              <option key={p.actor} value={p.actor}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t('assign.save')}
          </Button>
        </form>
        {can('in_review') ? (
          <form action={reviewAction.bind(null, id)}>
            <Button type="submit" variant="secondary">
              {a.status === 'rejected' ? t('reopen') : t('startReview')}
            </Button>
          </form>
        ) : null}
      </Card>
      {a.status === 'approved' ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('approved.title')}</h2>
          <p className="text-body text-ink-2">
            {t('approved.body', { plan: a.approvedPlan ?? '', who: detail.decidedByName ?? '' })}
          </p>
          <form action={resendAction.bind(null, id)}>
            <Button type="submit" variant="secondary">
              {t('approved.resend')}
            </Button>
          </form>
        </Card>
      ) : null}
      {can('approved') ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('approve.title')}</h2>
          <p className="text-body text-ink-2">{t('approve.help', { email: a.contactEmail })}</p>
          <form action={approveAction.bind(null, id)} className="flex flex-col gap-3">
            <Select name="plan" label={t('approve.plan')} defaultValue={defaultPlan}>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                  {p.active ? '' : ` (${t('approve.inactive')})`}
                </option>
              ))}
            </Select>
            <Textarea name="note" label={t('approve.note')} maxLength={1000} rows={3} />
            <Button type="submit" className="self-start">
              {t('approve.submit')}
            </Button>
          </form>
        </Card>
      ) : null}
      {(['needs_info', 'rejected'] as const).map((k) =>
        can(k) ? (
          <Card key={k} className="flex flex-col gap-3">
            <h2 className="text-section">{t(`${k}.title`)}</h2>
            <p className="text-body text-ink-2">{t('email.help')}</p>
            <form
              action={(k === 'rejected' ? rejectAction : needsInfoAction).bind(null, id)}
              className="flex flex-col gap-3"
            >
              <Input
                name="subject"
                label={t('email.subject')}
                defaultValue={dec(k).subject}
                maxLength={200}
              />
              <Textarea
                name="body"
                label={t('email.body')}
                defaultValue={dec(k).body}
                rows={9}
                maxLength={5000}
              />
              <Button type="submit" variant="secondary" className="self-start">
                {t(`${k}.submit`)}
              </Button>
            </form>
          </Card>
        ) : null,
      )}
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('notes.title')}</h2>
        <form action={noteAction.bind(null, id)} className="flex flex-col gap-3">
          <Textarea name="body" label={t('notes.label')} maxLength={2000} rows={3} required />
          <Button type="submit" variant="secondary" className="self-start">
            {t('notes.add')}
          </Button>
        </form>
        {detail.notes.length === 0 ? (
          <p className="text-body text-ink-2">{t('notes.empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {detail.notes.map((n) => (
              <li key={n.id} className="border-t border-line pt-3">
                <p className="m-0 text-body whitespace-pre-wrap">{n.body}</p>
                <p className="m-0 text-caption text-ink-2">
                  {n.authorName} · {dt.format(n.createdAt)} UTC
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('log.title')}</h2>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {detail.events.map((e) => (
            <li key={e.id} className="text-body">
              <span className="font-bold">
                {t.has(`log.action.${e.action}`) ? t(`log.action.${e.action}`) : e.action}
              </span>
              {e.data.to ? ` → ${t(`status.${String(e.data.to)}`)}` : ''}
              {e.data.plan ? ` (${String(e.data.plan)})` : ''}
              {e.data.subject ? `: ${String(e.data.subject)}` : ''}
              <span className="block text-caption text-ink-2">
                {e.actor === 'applicant' ? t('log.applicant') : e.actorName} · {dt.format(e.at)} UTC
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}
