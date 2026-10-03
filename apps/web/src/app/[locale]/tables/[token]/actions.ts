'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  nameTableSlotCommand,
  resendTableLinkCommand,
  setTableCompanyCommand,
  tableLinkContext,
} from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import type { TableFormState } from '@/components/gala-tables.tsx';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * M4.2b: the table's claim link. The token (signed, one per table) is the only authority: it
 * resolves the table and its org; nothing comes from headers or the session.
 */
async function withTable<T>(
  token: string,
  run: (c: NonNullable<Awaited<ReturnType<typeof tableLinkContext>>>) => Promise<T>,
): Promise<T | TableFormState> {
  const c = await tableLinkContext(token);
  if (!c) return { ok: false, code: 'not_found' };
  try {
    return await run(c);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return failure(err);
  }
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function nameGuestAction(
  token: string,
  _prev: TableFormState,
  form: FormData,
): Promise<TableFormState> {
  return withTable(token, async (c) => {
    const firstName = text(form, 'firstName');
    await executeCommand(
      nameTableSlotCommand,
      {
        tableUnitId: c.id,
        firstName,
        lastName: text(form, 'lastName') || null,
        email: text(form, 'email') || null,
      },
      c.ctx,
      ports,
    );
    revalidatePath(`/tables/${token}`, 'page');
    return {
      ok: true,
      code: null,
      named: [firstName, text(form, 'lastName')].filter(Boolean).join(' '),
      stamp: Date.now(),
    };
  });
}

export async function companyAction(
  token: string,
  _prev: TableFormState,
  form: FormData,
): Promise<TableFormState> {
  return withTable(token, async (c) => {
    await executeCommand(
      setTableCompanyCommand,
      { tableUnitId: c.id, company: text(form, 'company') },
      c.ctx,
      ports,
    );
    revalidatePath(`/tables/${token}`, 'page');
    return { ok: true, code: null, stamp: Date.now() };
  });
}

export async function resendAction(token: string, _prev: TableFormState): Promise<TableFormState> {
  // It sends an email: counted per device like the other holder links (and once a minute per table).
  const limit = await limitAction('holderLink', { identity: `table:${token}`, scope: 'table-link' });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  return withTable(token, async (c) => {
    const { sent } = await executeCommand(resendTableLinkCommand, { tableUnitId: c.id }, c.ctx, ports);
    return { ok: true, code: null, sent: sent ? 1 : 0, stamp: Date.now() };
  });
}
