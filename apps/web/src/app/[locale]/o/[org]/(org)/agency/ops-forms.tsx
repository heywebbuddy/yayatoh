'use client';

import { Alert, Button, Checkbox, FieldMessage, Input, Radio, Select, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import type { OpsState, Outcome } from './ops-actions.ts';

/**
 * Agency v2 forms (M6.8b): every field has a label, errors come back from the server inline (the
 * commands own the rules), and success says what happened for each client.
 */

type Action = (prev: OpsState, form: FormData) => Promise<OpsState>;
export interface ClientOption {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}
export interface PersonOption {
  readonly id: string;
  readonly name: string;
}

const IDLE: OpsState = { kind: 'idle' };
const ROLES = ['manager', 'marketing', 'viewer'] as const;

function useField(state: OpsState) {
  const t = useTranslations('agencyOps');
  return {
    error: (field: string) =>
      state.kind === 'error' && state.fields?.[field] ? t(`field.${state.fields[field]}`) : undefined,
    value: (field: string) => {
      const v = state.kind === 'error' ? state.values?.[field] : undefined;
      return typeof v === 'string' ? v : undefined;
    },
    values: (field: string): readonly string[] => {
      const v = state.kind === 'error' ? state.values?.[field] : undefined;
      return Array.isArray(v) ? v : [];
    },
  };
}

/** A general error (no field to attach it to) and the per-client outcomes after success. */
function Result({
  state,
  clients,
  done,
}: {
  state: OpsState;
  clients: readonly ClientOption[];
  done?: string;
}) {
  const t = useTranslations('agencyOps');
  const tr = useTranslations();
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? t('unknownClient');
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {state.kind === 'error' && !state.fields ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      {state.kind === 'done' && done ? <Alert tone="success" title={done} /> : null}
      {state.kind === 'done' && state.outcomes && state.outcomes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-body" aria-label={t('outcomesLabel')}>
          {state.outcomes.map((o: Outcome) => (
            <li key={o.clientOrgId} className="flex flex-wrap gap-1">
              <span className="font-semibold">{nameOf(o.clientOrgId)}:</span>
              <span>{t(`outcome.${o.status}`)}</span>
              {o.errorCode ? (
                <span className="text-ink-2">
                  ({t(`reason.${o.errorCode in REASONS ? o.errorCode : 'other'}`)})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
const REASONS = { forbidden: 1, not_found: 1, conflict: 1, module_not_enabled: 1 } as const;

/** Checkboxes for the clients to publish or send to (the agency's live clients only). */
function ClientChecks({
  clients,
  idPrefix,
  legend,
  error,
  selected,
}: {
  clients: readonly ClientOption[];
  idPrefix: string;
  legend: string;
  error?: string;
  selected: readonly string[];
}) {
  const ta = useTranslations('agencies');
  const errorId = `${idPrefix}-clients-error`;
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={error ? errorId : undefined}>
      <legend className="text-[13px] font-bold text-ink">{legend}</legend>
      {clients.map((c) => (
        <Checkbox
          key={c.id}
          id={`${idPrefix}-client-${c.id}`}
          name="client"
          value={c.id}
          defaultChecked={selected.includes(c.id)}
          label={c.name}
          hint={ta('roleLabel', { role: c.role })}
        />
      ))}
      {error ? <FieldMessage id={`${idPrefix}-clients`} error={error} /> : null}
    </fieldset>
  );
}

export function PrivacyForm({
  action,
  templateId,
  notes,
  parts,
}: {
  action: Action;
  templateId: string;
  notes: string;
  parts: readonly string[];
}) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-3">
      <Textarea
        id={`notes-${templateId}`}
        name="notes"
        rows={2}
        maxLength={2000}
        label={t('library.privateNotes')}
        hint={t('library.privateNotesHint')}
        defaultValue={notes}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[13px] font-bold text-ink">{t('library.privateTitle')}</legend>
        <Checkbox
          id={`questions-${templateId}`}
          name="part-questions"
          defaultChecked={parts.includes('questions')}
          label={t('library.partQuestions')}
        />
        <Checkbox
          id={`seating-${templateId}`}
          name="part-seating"
          defaultChecked={parts.includes('seating')}
          label={t('library.partSeating')}
        />
      </fieldset>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('library.savePrivacy')}
        </Button>
      </div>
      <Result
        state={state}
        clients={[]}
        done={state.kind === 'done' ? t('library.privacySaved') : undefined}
      />
    </form>
  );
}

/** Publish a template or a brand kit to chosen clients. */
export function PublishForm({
  action,
  clients,
  idPrefix,
  label,
}: {
  action: Action;
  clients: readonly ClientOption[];
  idPrefix: string;
  /** The accessible name of the publish button ("Publish Gala kit"). */
  label: string;
}) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  const f = useField(state);
  if (clients.length === 0) return <p className="text-body text-ink-2">{t('library.noClients')}</p>;
  return (
    <form action={formAction} noValidate className="flex flex-col gap-3">
      <ClientChecks
        clients={clients}
        idPrefix={idPrefix}
        legend={t('library.publishTo')}
        error={f.error('client')}
        selected={f.values('client')}
      />
      <div>
        <Button type="submit" disabled={pending} aria-label={label}>
          {t('library.publish')}
        </Button>
      </div>
      <Result state={state} clients={clients} />
    </form>
  );
}

export function KitForm({ action }: { action: Action }) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  const f = useField(state);
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-3"
      key={state.kind === 'done' ? `done-${state.at}` : 'form'}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          id="kit-name"
          name="name"
          maxLength={80}
          label={t('library.kitName')}
          defaultValue={f.value('name')}
          error={f.error('name')}
        />
        <Input
          id="kit-color"
          name="color"
          maxLength={7}
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          label={t('library.kitColor')}
          hint={t('library.kitColorHint')}
          defaultValue={f.value('color')}
          error={f.error('color')}
        />
      </div>
      <Textarea
        id="kit-notes"
        name="notes"
        rows={2}
        maxLength={2000}
        label={t('library.privateNotes')}
        hint={t('library.privateNotesHint')}
        defaultValue={f.value('notes')}
      />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('library.createKit')}
        </Button>
      </div>
      <Result
        state={state}
        clients={[]}
        done={state.kind === 'done' ? t('library.kitCreated', { name: state.name ?? '' }) : undefined}
      />
    </form>
  );
}

export function FanoutForm({ action, clients }: { action: Action; clients: readonly ClientOption[] }) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  const f = useField(state);
  if (clients.length === 0) return <p className="text-body text-ink-2">{t('library.noClients')}</p>;
  const audience = f.value('audience') ?? 'everyone';
  const mode = f.value('mode') ?? 'draft';
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
      key={state.kind === 'done' ? `done-${state.at}` : 'form'}
    >
      <Input
        id="fanout-name"
        name="name"
        maxLength={120}
        label={t('campaigns.name')}
        hint={t('campaigns.nameHint')}
        defaultValue={f.value('name')}
        error={f.error('name')}
      />
      <Input
        id="fanout-subject"
        name="subject"
        maxLength={150}
        label={t('campaigns.subject')}
        defaultValue={f.value('subject')}
        error={f.error('subject')}
      />
      <Input
        id="fanout-heading"
        name="heading"
        maxLength={200}
        label={t('campaigns.heading')}
        defaultValue={f.value('heading')}
        error={f.error('heading')}
      />
      <Textarea
        id="fanout-body"
        name="body"
        rows={5}
        maxLength={5000}
        label={t('campaigns.body')}
        defaultValue={f.value('body')}
        error={f.error('body')}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[13px] font-bold text-ink">{t('campaigns.audience')}</legend>
        {(['everyone', 'attendees'] as const).map((a) => (
          <Radio
            key={a}
            id={`fanout-audience-${a}`}
            name="audience"
            value={a}
            defaultChecked={audience === a}
            label={t(`campaigns.audience_${a}`)}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[13px] font-bold text-ink">{t('campaigns.mode')}</legend>
        {(['draft', 'send'] as const).map((m) => (
          <Radio
            key={m}
            id={`fanout-mode-${m}`}
            name="mode"
            value={m}
            defaultChecked={mode === m}
            label={t(`campaigns.mode_${m}`)}
          />
        ))}
      </fieldset>
      <ClientChecks
        clients={clients}
        idPrefix="fanout"
        legend={t('campaigns.clients')}
        error={f.error('client')}
        selected={f.values('client')}
      />
      <div>
        <Button type="submit" disabled={pending}>
          {t('campaigns.submit')}
        </Button>
      </div>
      <Result
        state={state}
        clients={clients}
        done={state.kind === 'done' ? t('campaigns.done') : undefined}
      />
    </form>
  );
}

function RoleSelect({ id, value, error }: { id: string; value?: string; error?: string }) {
  const t = useTranslations('agencyOps');
  const ta = useTranslations('agencies');
  return (
    <Select
      id={id}
      name="role"
      label={t('team.role')}
      defaultValue={value ?? 'viewer'}
      error={error}
      options={ROLES.map((r) => ({
        value: r,
        label: ta('roleLabel', { role: r }),
        text: ta('roleLabel', { role: r }),
      }))}
    />
  );
}

export function TeamForm({
  action,
  people,
  idPrefix,
}: {
  action: Action;
  people: readonly PersonOption[];
  idPrefix: string;
}) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  const f = useField(state);
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-3"
      key={state.kind === 'done' ? `done-${state.at}` : 'form'}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          id={`${idPrefix}-person`}
          name="person"
          label={t('team.person')}
          placeholder={t('team.choosePerson')}
          defaultValue={f.value('person') ?? ''}
          error={f.error('person')}
          options={people.map((p) => ({ value: p.id, label: p.name, text: p.name }))}
        />
        <RoleSelect id={`${idPrefix}-role`} value={f.value('role')} error={f.error('role')} />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('team.add')}
        </Button>
      </div>
      <Result state={state} clients={[]} done={state.kind === 'done' ? t('team.added') : undefined} />
    </form>
  );
}

export function DayOfForm({
  action,
  people,
  events,
  idPrefix,
}: {
  action: Action;
  people: readonly PersonOption[];
  events: readonly { id: string; label: string }[];
  idPrefix: string;
}) {
  const t = useTranslations('agencyOps');
  const [state, formAction, pending] = useActionState(action, IDLE);
  const f = useField(state);
  if (events.length === 0) return <p className="text-body text-ink-2">{t('team.noEvents')}</p>;
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-3"
      key={state.kind === 'done' ? `done-${state.at}` : 'form'}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Select
          id={`${idPrefix}-dayof-person`}
          name="person"
          label={t('team.person')}
          placeholder={t('team.choosePerson')}
          defaultValue={f.value('person') ?? ''}
          error={f.error('person')}
          options={people.map((p) => ({ value: p.id, label: p.name, text: p.name }))}
        />
        <Select
          id={`${idPrefix}-dayof-event`}
          name="event"
          label={t('team.event')}
          hint={t('team.windowHint')}
          placeholder={t('team.chooseEvent')}
          defaultValue={f.value('event') ?? ''}
          error={f.error('event')}
          options={events.map((e) => ({ value: e.id, label: e.label, text: e.label }))}
        />
        <RoleSelect id={`${idPrefix}-dayof-role`} value={f.value('role')} error={f.error('role')} />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('team.addDayOf')}
        </Button>
      </div>
      <Result state={state} clients={[]} done={state.kind === 'done' ? t('team.dayOfAdded') : undefined} />
    </form>
  );
}

/** A one-button step-up form (handover): "Confirm it's you" opens, then it resubmits. */
export function HandoverForm({
  action,
  label,
  children,
}: {
  action: Action;
  label: string;
  children: string;
}) {
  const tr = useTranslations();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, IDLE);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary" disabled={pending} aria-label={label}>
        {children}
      </Button>
      <div aria-live="polite">
        {state.kind === 'error' ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      </div>
    </form>
  );
}
