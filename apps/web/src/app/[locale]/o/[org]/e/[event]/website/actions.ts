'use server';

import {
  addGuestSiteBlockCommand,
  MAX_BLOCK_ITEMS,
  moveGuestSiteBlockCommand,
  publishGuestSiteCommand,
  removeGuestSiteBlockCommand,
  type SiteBlockKind,
  saveGuestSiteCommand,
  setGuestSitePasswordCommand,
  updateGuestSiteBlockCommand,
} from '@yayatoh/guests';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * The guest website's host tools (M4.5a). Every write goes through a guests command
 * (`guests:write`), so a viewer posting a form is refused by the server, not only by the missing
 * control.
 */
type State = ProgramFormState;

async function run(
  org: string,
  event: string,
  write: (eventId: string, ctx: Parameters<typeof executeCommand>[2]) => Promise<unknown>,
  fieldOf: (field: string) => string = (f) => f,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'website');
  try {
    await write(ev.id, data.ctx);
  } catch (err) {
    const state = failure(err);
    // A content field (`content.items.2.url`) points at its input (`i:2:url`).
    const field = isDomainError(err) ? (err.details as { field?: unknown } | undefined)?.field : undefined;
    return typeof field === 'string' ? { ...state, fields: [fieldOf(field)] } : state;
  }
  revalidatePath(`/o/${org}/e/${event}/website`);
  return success();
}

export async function saveSiteAction(org: string, event: string, _p: State, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      saveGuestSiteCommand,
      {
        eventId,
        title: String(form.get('title') ?? ''),
        intro: textOrNull(form, 'intro'),
        contentLocale: String(form.get('contentLocale') ?? 'en'),
      },
      ctx,
      ports,
    ),
  );
}

export async function setPasswordAction(org: string, event: string, _p: State, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      setGuestSitePasswordCommand,
      { eventId, password: String(form.get('password') ?? '') },
      ctx,
      ports,
    ),
  );
}

export async function publishSiteAction(
  org: string,
  event: string,
  published: boolean,
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(publishGuestSiteCommand, { eventId, published }, ctx, ports),
  );
}

export async function addBlockAction(org: string, event: string, _p: State, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      addGuestSiteBlockCommand,
      { eventId, kind: String(form.get('kind') ?? '') as SiteBlockKind },
      ctx,
      ports,
    ),
  );
}

/** The item rows a list block's form posts (`i:{n}:{field}`); rows left blank are dropped. */
function rows(form: FormData, fields: readonly string[]) {
  const out: { index: number; values: Record<string, string> }[] = [];
  for (let i = 0; i <= MAX_BLOCK_ITEMS; i++) {
    if (!fields.some((f) => form.has(`i:${i}:${f}`))) continue;
    const values = Object.fromEntries(fields.map((f) => [f, String(form.get(`i:${i}:${f}`) ?? '').trim()]));
    if (Object.values(values).some(Boolean)) out.push({ index: i, values });
  }
  return out;
}

const ITEM_FIELDS: Record<'travel' | 'registry' | 'faq', readonly string[]> = {
  travel: ['title', 'details', 'url'],
  registry: ['label', 'url'],
  faq: ['question', 'answer'],
};

export async function updateBlockAction(
  org: string,
  event: string,
  blockId: string,
  kind: SiteBlockKind,
  _p: State,
  form: FormData,
) {
  let content: unknown;
  let indexOf: number[] = [];
  if (kind === 'text') content = { body: String(form.get('body') ?? '') };
  else if (kind === 'program')
    content = {
      show: form.get('show') === 'chosen' ? 'chosen' : 'everyone',
      subEventIds: form.getAll('subEventIds').map(String),
    };
  else {
    const list = rows(form, ITEM_FIELDS[kind]);
    indexOf = list.map((r) => r.index);
    content = { items: list.map((r) => r.values) };
  }
  return run(
    org,
    event,
    (eventId, ctx) =>
      executeCommand(
        updateGuestSiteBlockCommand,
        { eventId, blockId, heading: textOrNull(form, 'heading'), content },
        ctx,
        ports,
      ),
    (field) => {
      const m = /^content\.items\.(\d+)\.(\w+)/.exec(field);
      if (m) return `i:${indexOf[Number(m[1])] ?? m[1]}:${m[2]}`;
      if (field.startsWith('content.subEventIds')) return 'subEventIds';
      return field === 'content.body' ? 'body' : field;
    },
  );
}

export async function moveBlockAction(
  org: string,
  event: string,
  blockId: string,
  direction: 'up' | 'down',
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(moveGuestSiteBlockCommand, { eventId, blockId, direction }, ctx, ports),
  );
}

export async function removeBlockAction(
  org: string,
  event: string,
  blockId: string,
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(removeGuestSiteBlockCommand, { eventId, blockId }, ctx, ports),
  );
}
