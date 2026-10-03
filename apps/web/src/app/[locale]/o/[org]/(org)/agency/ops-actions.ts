'use server';

import {
  assignStaffCommand,
  FANOUT_AUDIENCES,
  FANOUT_MODES,
  fanOutCampaign,
  handOverClient,
  PRIVATE_PARTS,
  publishBrandKit,
  publishTemplate,
  revokeStaffCommand,
  saveBrandKitCommand,
  setTemplatePrivacyCommand,
} from '@yayatoh/agency-ops';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { AGENCY_GRANT_ROLES } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { ports } from '@/server/ports.ts';
import { loadAgencyV2 } from './load.ts';

/**
 * Agency v2 actions (M6.8b). Each runs the module's command or orchestrator with the signed-in
 * agency member's context; the commands re-check the switch, the entitlement, the permission and
 * every client's live grant.
 */

/** One client's outcome of a publish or a fan-out, as the forms show it. */
export interface Outcome {
  readonly clientOrgId: string;
  readonly status: string;
  readonly errorCode: string | null;
}

export type OpsState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'done';
      readonly outcomes?: readonly Outcome[];
      readonly name?: string;
      readonly at: number;
    }
  | {
      readonly kind: 'error';
      readonly code: string;
      /** Field → message key (`required`, `invalid`, `taken`, `chooseClients`). */
      readonly fields?: Readonly<Record<string, string>>;
      readonly values?: Readonly<Record<string, string | readonly string[]>>;
    };

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const ids = (form: FormData) => form.getAll('client').map(String).filter(Boolean);
const codeOf = (err: unknown) => (isDomainError(err) ? err.code : 'internal');

export async function savePrivacyAction(
  org: string,
  templateId: string,
  _prev: OpsState,
  form: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const parts = PRIVATE_PARTS.filter((p) => form.get(`part-${p}`) === 'on');
  try {
    await executeCommand(
      setTemplatePrivacyCommand,
      { templateId, privateNotes: str(form, 'notes') || null, privateParts: parts },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { kind: 'error', code: codeOf(err) };
  }
  revalidatePath(`/o/${org}/agency/library`);
  return { kind: 'done', at: Date.now() };
}

export async function publishTemplateAction(
  org: string,
  templateId: string,
  _prev: OpsState,
  form: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const clientOrgIds = ids(form);
  if (clientOrgIds.length === 0)
    return { kind: 'error', code: 'validation_failed', fields: { client: 'chooseClients' } };
  try {
    const outcomes = await publishTemplate(data.ctx, { templateId, clientOrgIds }, ports);
    revalidatePath(`/o/${org}/agency/library`);
    return { kind: 'done', outcomes, at: Date.now() };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), values: { client: clientOrgIds } };
  }
}

export async function saveKitAction(org: string, _prev: OpsState, form: FormData): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const name = str(form, 'name');
  const brandColor = str(form, 'color');
  const notes = str(form, 'notes');
  const values = { name, color: brandColor, notes };
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'required';
  if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) fields.color = brandColor ? 'invalidColor' : 'required';
  if (Object.keys(fields).length > 0) return { kind: 'error', code: 'validation_failed', fields, values };
  try {
    const kit = await executeCommand(
      saveBrandKitCommand,
      { name, brandColor, privateNotes: notes || null },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/agency/library`);
    return { kind: 'done', name: kit.name, at: Date.now() };
  } catch (err) {
    const code = codeOf(err);
    if (code === 'conflict') return { kind: 'error', code, fields: { name: 'kitNameTaken' }, values };
    return { kind: 'error', code, values };
  }
}

export async function publishKitAction(
  org: string,
  kitId: string,
  _prev: OpsState,
  form: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const clientOrgIds = ids(form);
  if (clientOrgIds.length === 0)
    return { kind: 'error', code: 'validation_failed', fields: { client: 'chooseClients' } };
  try {
    const outcomes = await publishBrandKit(data.ctx, { kitId, clientOrgIds }, ports);
    revalidatePath(`/o/${org}/agency/library`);
    return { kind: 'done', outcomes, at: Date.now() };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), values: { client: clientOrgIds } };
  }
}

const FANOUT_FIELDS = ['name', 'subject', 'heading', 'body'] as const;

export async function fanOutAction(org: string, _prev: OpsState, form: FormData): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const values: Record<string, string | string[]> = {};
  const fields: Record<string, string> = {};
  for (const f of FANOUT_FIELDS) {
    values[f] = str(form, f);
    if (!values[f]) fields[f] = 'required';
  }
  const audience = str(form, 'audience');
  const mode = str(form, 'mode');
  const clientOrgIds = ids(form);
  values.audience = audience;
  values.mode = mode;
  values.client = clientOrgIds;
  if (clientOrgIds.length === 0) fields.client = 'chooseClients';
  if (Object.keys(fields).length > 0) return { kind: 'error', code: 'validation_failed', fields, values };
  try {
    const r = await fanOutCampaign(
      data.ctx,
      {
        name: String(values.name),
        subject: String(values.subject),
        heading: String(values.heading),
        body: String(values.body),
        audience: (FANOUT_AUDIENCES as readonly string[]).includes(audience)
          ? (audience as (typeof FANOUT_AUDIENCES)[number])
          : 'everyone',
        mode: (FANOUT_MODES as readonly string[]).includes(mode)
          ? (mode as (typeof FANOUT_MODES)[number])
          : 'draft',
        clientOrgIds,
      },
      ports,
    );
    revalidatePath(`/o/${org}/agency/campaigns`);
    return { kind: 'done', outcomes: r.targets, name: String(values.name), at: Date.now() };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), values };
  }
}

const roleOf = (v: string) =>
  (AGENCY_GRANT_ROLES as readonly string[]).includes(v) ? (v as (typeof AGENCY_GRANT_ROLES)[number]) : null;

export async function addTeamAction(
  org: string,
  clientOrgId: string,
  _prev: OpsState,
  form: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const userId = str(form, 'person');
  const role = roleOf(str(form, 'role'));
  const values = { person: userId, role: str(form, 'role') };
  const fields: Record<string, string> = {};
  if (!userId) fields.person = 'required';
  if (!role) fields.role = 'required';
  if (Object.keys(fields).length > 0 || !role)
    return { kind: 'error', code: 'validation_failed', fields, values };
  try {
    await executeCommand(assignStaffCommand, { kind: 'team', clientOrgId, userId, role }, data.ctx, ports);
  } catch (err) {
    const code = codeOf(err);
    return code === 'validation_failed'
      ? { kind: 'error', code, fields: { person: 'notMember' }, values }
      : { kind: 'error', code, values };
  }
  revalidatePath(`/o/${org}/agency/team`);
  return { kind: 'done', at: Date.now() };
}

export async function addDayOfAction(
  org: string,
  clientOrgId: string,
  _prev: OpsState,
  form: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  const userId = str(form, 'person');
  const eventId = str(form, 'event');
  const role = roleOf(str(form, 'role'));
  const values = { person: userId, event: eventId, role: str(form, 'role') };
  const fields: Record<string, string> = {};
  if (!userId) fields.person = 'required';
  if (!eventId) fields.event = 'required';
  if (!role) fields.role = 'required';
  if (Object.keys(fields).length > 0 || !role)
    return { kind: 'error', code: 'validation_failed', fields, values };
  try {
    await executeCommand(
      assignStaffCommand,
      { kind: 'day_of', clientOrgId, userId, eventId, role },
      data.ctx,
      ports,
    );
  } catch (err) {
    const code = codeOf(err);
    const reason = isDomainError(err) ? String(err.details?.reason ?? '') : '';
    if (code === 'validation_failed')
      return {
        kind: 'error',
        code,
        fields: reason === 'not_member' ? { person: 'notMember' } : { event: 'passOver' },
        values,
      };
    return { kind: 'error', code, values };
  }
  revalidatePath(`/o/${org}/agency/team`);
  return { kind: 'done', at: Date.now() };
}

export async function revokeStaffAction(
  org: string,
  clientOrgId: string,
  staffGrantId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const { data } = await loadAgencyV2(org);
  try {
    await executeCommand(revokeStaffCommand, { clientOrgId, staffGrantId }, data.ctx, ports);
  } catch (err) {
    return { code: codeOf(err) };
  }
  revalidatePath(`/o/${org}/agency/team`);
}

/** Hand a client over (step-up): the client keeps everything; the agency's access ends. */
export async function handOverAction(
  org: string,
  clientOrgId: string,
  _prev: OpsState,
  _form?: FormData,
): Promise<OpsState> {
  const { data } = await loadAgencyV2(org);
  try {
    await handOverClient(data.ctx, { clientOrgId }, ports);
  } catch (err) {
    return { kind: 'error', code: codeOf(err) };
  }
  revalidatePath(`/o/${org}/agency`, 'layout');
  return { kind: 'done', at: Date.now() };
}
