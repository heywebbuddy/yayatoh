'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { payoutAccountIdQuery, payoutAccountQuery } from '@yayatoh/payments';
import {
  addDomainCommand,
  ensureManagedDomainCommand,
  listDomainsQuery,
  recordDomainCheckCommand,
  recordDomainWalletsCommand,
  removeDomainCommand,
  roleCan,
  setPrimaryDomainCommand,
} from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { type ConsoleData, loadConsole } from '@/server/console.ts';
import { getDomainProvider } from '@/server/domains.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import type { SettingsState } from '../settings/actions.ts';

const fail = (err: unknown): SettingsState => ({
  ok: false,
  code: isDomainError(err) ? err.code : 'internal',
});

/**
 * Add a custom domain: the command claims the hostname, then the hosting provider adds it
 * (outside the transaction) and we record the DNS records the organizer must publish.
 */
export async function addDomainAction(
  org: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const data = await loadConsole(org);
  try {
    const d = await executeCommand(
      addDomainCommand,
      { hostname: String(form.get('hostname') ?? '') },
      data.ctx,
      ports,
    );
    const added = await getDomainProvider().addDomain(d.hostname);
    const { providerRef, ...check } = added;
    await executeCommand(recordDomainCheckCommand, { domainId: d.id, providerRef, check }, data.ctx, ports);
    revalidatePath(`/o/${org}/domains`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** Register Apple Pay / Google Pay for an active host: platform account, and the connected one. */
async function registerWallets(data: ConsoleData, domainId: string, hostname: string) {
  const payments = getPaymentProvider();
  const pmd = await payments.registerPaymentMethodDomain({ hostname, accountId: null });
  const payout = await executeQuery(payoutAccountQuery, {}, data.ctx, ports);
  if (payout.state === 'active' && roleCan(data.role, 'payouts:manage')) {
    const { accountId } = await executeQuery(payoutAccountIdQuery, {}, data.ctx, ports);
    if (accountId) await payments.registerPaymentMethodDomain({ hostname, accountId });
  }
  await executeCommand(
    recordDomainWalletsCommand,
    { domainId, paymentMethodDomainId: pmd.id },
    data.ctx,
    ports,
  );
}

/** "Check now": ask the provider about DNS and certificates; register wallets once active. */
export async function checkDomainAction(org: string, domainId: string): Promise<void> {
  const data = await loadConsole(org);
  const d = (await executeQuery(listDomainsQuery, {}, data.ctx, ports)).find((x) => x.id === domainId);
  if (!d) return;
  let status = d.status;
  if (!d.managed) {
    const check = await getDomainProvider().checkDomain(d.hostname);
    status = (await executeCommand(recordDomainCheckCommand, { domainId, check }, data.ctx, ports)).status;
  }
  if (status === 'active' && !d.walletsReady) await registerWallets(data, domainId, d.hostname);
  revalidatePath(`/o/${org}/domains`);
}

/** Make a domain primary (step-up command: answers `step_up_required` when the session is not fresh). */
export async function setPrimaryDomainAction(org: string, domainId: string): Promise<SettingsState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(setPrimaryDomainCommand, { domainId }, data.ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/o/${org}/domains`);
  return { ok: true, code: null };
}

/** Remove a custom domain here first (frees the name), then at the hosting provider. */
export async function removeDomainAction(org: string, domainId: string): Promise<SettingsState> {
  const data = await loadConsole(org);
  let hostname: string;
  try {
    ({ hostname } = await executeCommand(removeDomainCommand, { domainId }, data.ctx, ports));
  } catch (err) {
    return fail(err);
  }
  await getDomainProvider().removeDomain(hostname);
  revalidatePath(`/o/${org}/domains`);
  return { ok: true, code: null };
}

/** Orgs created before domains existed get their managed subdomain on request. */
export async function ensureManagedDomainAction(org: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(ensureManagedDomainCommand, {}, data.ctx, ports);
  revalidatePath(`/o/${org}/domains`);
}
