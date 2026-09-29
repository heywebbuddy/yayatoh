'use server';

import { resolveTxt } from 'node:dns/promises';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  addSendingDomainCommand,
  checkDmarc,
  fakeResolveTxt,
  identityPortFromEnv,
  normalizeSendingDomain,
  type ResolveTxt,
  recordSendingDomainCheckCommand,
  removeSendingDomainCommand,
  type SendingIdentityPort,
  sendingSetupQuery,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation.ts';
import { type ConsoleData, loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface DomainFormState {
  readonly error:
    | 'required'
    | 'invalid'
    | 'already_set'
    | 'domain_taken'
    | 'unavailable'
    | 'forbidden'
    | 'internal'
    | null;
  readonly value: string;
}

/** DMARC lookups: real DNS with SES; the fake resolver (a `nodmarc` label) with the fake identities. */
const resolverFor = (port: SendingIdentityPort): ResolveTxt =>
  port.name === 'ses' ? resolveTxt : fakeResolveTxt;

/** Ask the provider and DNS about the domain, and record what they said. */
async function check(
  data: ConsoleData,
  port: SendingIdentityPort,
  id: string,
  domain: string,
  created = false,
) {
  const identity = created ? await port.create(domain) : await port.status(domain);
  const dmarc = await checkDmarc(domain, resolverFor(port));
  await executeCommand(
    recordSendingDomainCheckCommand,
    {
      id,
      dkim: identity.dkim,
      spf: identity.spf,
      dmarc: dmarc.status,
      dmarcPolicy: (dmarc.policy as 'none' | 'quarantine' | 'reject' | null) ?? null,
      records: identity.records,
      providerRef: identity.providerRef,
    },
    data.ctx,
    ports,
  );
}

/**
 * Add the org's sending domain (owners and admins): the command claims it, then the provider
 * creates the identity (outside the transaction) and we record the DNS records to publish.
 */
export async function addSendingDomainAction(
  org: string,
  _prev: DomainFormState,
  form: FormData,
): Promise<DomainFormState> {
  const data = await loadConsole(org);
  const value = String(form.get('domain') ?? '').trim();
  if (!value) return { error: 'required', value };
  if (!normalizeSendingDomain(value)) return { error: 'invalid', value };
  const port = identityPortFromEnv(process.env);
  if (!port) return { error: 'unavailable', value };
  let added: { id: string; domain: string };
  try {
    added = await executeCommand(
      addSendingDomainCommand,
      { domain: value, provider: port.name },
      data.ctx,
      ports,
    );
  } catch (err) {
    const reason = isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal';
    if (reason === 'already_set' || reason === 'domain_taken' || reason === 'forbidden')
      return { error: reason, value };
    if (reason === 'invalid_domain') return { error: 'invalid', value };
    return { error: 'internal', value };
  }
  try {
    await check(data, port, added.id, added.domain, true);
  } catch {
    // The provider was unreachable: the domain stays pending; "Check DNS now" retries.
  }
  revalidatePath(`/o/${org}/sending`);
  return redirect({ href: `/o/${org}/sending?done=added`, locale: data.ctx.locale });
}

/** "Check DNS now": the identity's DKIM and MAIL FROM status, and DMARC through DNS. */
export async function checkSendingDomainAction(org: string, id: string): Promise<void> {
  const data = await loadConsole(org);
  const setup = await executeQuery(sendingSetupQuery, {}, data.ctx, ports);
  const port = identityPortFromEnv(process.env);
  let outcome = 'checked';
  if (!setup.domain || setup.domain.id !== id || !port) outcome = 'error';
  else
    try {
      await check(data, port, id, setup.domain.domain);
    } catch (err) {
      outcome = isDomainError(err) && err.code === 'forbidden' ? 'forbidden' : 'error';
    }
  revalidatePath(`/o/${org}/sending`);
  redirect({ href: `/o/${org}/sending?done=${outcome}`, locale: data.ctx.locale });
}

/** Remove the sending domain: here first (mail goes back to the platform sender), then at the provider. */
export async function removeSendingDomainAction(org: string, id: string): Promise<void> {
  const data = await loadConsole(org);
  let outcome = 'removed';
  try {
    const removed = await executeCommand(removeSendingDomainCommand, { id }, data.ctx, ports);
    const port = identityPortFromEnv(process.env);
    if (port?.name === removed.provider) await port.remove(removed.domain).catch(() => undefined);
  } catch (err) {
    outcome = isDomainError(err) && err.code === 'forbidden' ? 'forbidden' : 'error';
  }
  revalidatePath(`/o/${org}/sending`);
  redirect({ href: `/o/${org}/sending?done=${outcome}`, locale: data.ctx.locale });
}
