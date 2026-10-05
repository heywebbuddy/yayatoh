/**
 * The custom-domain connect wizard (U3): which step a domain is on, from what the hosting
 * provider last reported. Pure, so the page and the unit tests agree.
 *
 * 1. `domain`  — added (always done once the domain exists)
 * 2. `dns`     — publish the DNS records (waiting for DNS, or the records point elsewhere)
 * 3. `verify`  — DNS found, the provider is verifying it
 * 4. `ssl`     — verified, the certificate is being issued
 * 5. `primary` — live; make it the address links and emails use
 */
export const WIZARD_STEPS = ['domain', 'dns', 'verify', 'ssl', 'primary'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardDomain {
  readonly managed: boolean;
  readonly status: 'pending_dns' | 'verifying' | 'active' | 'failed';
  readonly sslStatus: 'pending' | 'issued' | null;
  readonly isPrimary: boolean;
}

/** The current step, or `done` when the domain is live and primary (or managed: nothing to do). */
export function wizardStep(d: WizardDomain): WizardStep | 'done' {
  if (d.managed) return 'done';
  if (d.status === 'pending_dns' || d.status === 'failed') return 'dns';
  if (d.status === 'verifying') return 'verify';
  if (d.sslStatus !== 'issued') return 'ssl';
  return d.isPrimary ? 'done' : 'primary';
}

/** Each step's state for the stepper. */
export function wizardStates(d: WizardDomain): { step: WizardStep; state: 'done' | 'current' | 'todo' }[] {
  const at = wizardStep(d);
  const i = at === 'done' ? WIZARD_STEPS.length : WIZARD_STEPS.indexOf(at);
  return WIZARD_STEPS.map((step, n) => ({ step, state: n < i ? 'done' : n === i ? 'current' : 'todo' }));
}
