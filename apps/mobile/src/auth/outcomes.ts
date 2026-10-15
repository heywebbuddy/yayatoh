/**
 * What a sign-in outcome means for the screen (M7.3a): the sentence to show, whether the person has
 * to start over, and how long to wait. Pure, so each rule is unit-tested; the hook below turns the
 * sentence into the person's language.
 */
import type { EmailCodeOutcome, SignInFailure, SignInOutcome, StepUpOutcome } from '@yayatoh/mobile-core';
import { useTranslations } from 'use-intl';

/** After these the challenge or the code is spent: trying the same screen again cannot work. */
export const START_OVER: readonly SignInFailure[] = ['too_many_attempts', 'invalid_challenge'];

export type MessageSpec = { readonly key: string; readonly values?: Record<string, number> } | null;

/** How many minutes to show for a wait of `seconds` (never zero). */
export const minutesFor = (seconds: number): number => Math.max(1, Math.ceil(seconds / 60));

type Outcome = SignInOutcome | EmailCodeOutcome | StepUpOutcome;

export interface OutcomeContext {
  /** A wrong emailed code and an expired one look the same to the server: say both. */
  readonly emailedCode?: boolean;
}

/** The catalog key (and values) for an outcome that did not sign anyone in; null when nothing is shown. */
export function messageFor(outcome: Outcome, ctx: OutcomeContext = {}): MessageSpec {
  switch (outcome.kind) {
    case 'rateLimited':
      return outcome.retryAfterSeconds
        ? { key: 'core.signIn.rateLimited', values: { minutes: minutesFor(outcome.retryAfterSeconds) } }
        : { key: 'signIn.rateLimitedNoTime' };
    case 'unavailable':
      return { key: 'core.signIn.unavailable' };
    case 'unsupported':
      return { key: 'core.signIn.unsupported' };
    case 'failed':
      if (ctx.emailedCode && outcome.reason === 'invalid_code') return { key: 'signIn.code.wrongOrExpired' };
      if (outcome.reason === 'invalid_password') return { key: 'core.stepUp.invalid_password' };
      return { key: `core.signIn.failed.${outcome.reason}` };
    default:
      return null;
  }
}

export const needsStartOver = (outcome: Outcome): boolean =>
  outcome.kind === 'failed' && (START_OVER as readonly string[]).includes(outcome.reason);

/** Seconds the server asked us to wait, or null. */
export const waitSeconds = (outcome: Outcome): number | null =>
  outcome.kind === 'rateLimited' ? outcome.retryAfterSeconds : null;

/** `messageFor`, in the person's language. */
export function useOutcomeText() {
  const t = useTranslations();
  return (outcome: Outcome, ctx?: OutcomeContext): string | null => {
    const spec = messageFor(outcome, ctx);
    return spec ? t(spec.key, spec.values) : null;
  };
}
