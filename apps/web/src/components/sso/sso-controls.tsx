'use client';

import { Alert, Button, type ButtonVariant, Input, Select, Switch } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useRef, useState } from 'react';
import type { SsoFormState, TokenState } from '@/app/[locale]/o/[org]/(org)/sso/actions.ts';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { SSO_ROLE_KEYS } from './connection-form.tsx';

type Action = (prev: SsoFormState, form: FormData) => Promise<SsoFormState>;

function useErrorText() {
  const t = useTranslations('sso');
  const te = useTranslations();
  return (state: SsoFormState) =>
    state.kind === 'error'
      ? state.reason
        ? t(`reasons.${state.reason}` as 'reasons.test_required')
        : te(errorMessageKey(state.code))
      : null;
}

/** One button that runs a settings action (step-up when it asks), with its error inline. */
export function ActionButton({
  action,
  children,
  variant = 'secondary',
  fields,
  saved,
}: {
  action: Action;
  children: ReactNode;
  variant?: ButtonVariant;
  fields?: Record<string, string>;
  /** Said (politely) once the action succeeded. */
  saved?: string;
}) {
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as SsoFormState);
  const error = useErrorText()(state);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} disabled={pending} size="sm">
        {children}
      </Button>
      <div aria-live="polite">
        {error ? <Alert title={error} /> : null}
        {state.kind === 'saved' && saved ? (
          <p role="status" className="text-caption">
            {saved}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Add an email domain to verify. */
export function AddDomainForm({ action }: { action: Action }) {
  const t = useTranslations('sso');
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as SsoFormState);
  const error = useErrorText()(state);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        name="domain"
        label={t('domain')}
        hint={t('domainHint')}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        maxLength={253}
        error={
          state.kind === 'error'
            ? state.code === 'validation_failed'
              ? t('domainInvalid')
              : (error ?? undefined)
            : undefined
        }
        className="grow"
      />
      <Button type="submit" disabled={pending} className="sm:mb-6">
        {t('addDomain')}
      </Button>
      {state.kind === 'saved' ? (
        <p role="status" className="sr-only">
          {t('domainAdded')}
        </p>
      ) : null}
    </form>
  );
}

/** "Require single sign-on" for one verified domain (step-up). */
export function EnforceSwitch({
  action,
  enforced,
  domain,
}: {
  action: Action;
  enforced: boolean;
  domain: string;
}) {
  const t = useTranslations('sso');
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as SsoFormState);
  const error = useErrorText()(state);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="enforced" value={enforced ? 'off' : 'on'} />
      <Switch
        id={`enforce-${domain}`}
        name="enforcedSwitch"
        label={t('enforce', { domain })}
        checked={enforced}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
      />
      <div aria-live="polite">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}

/** The role a SCIM group maps to (or none), saved as soon as it is picked (step-up). */
export function GroupRoleSelect({
  action,
  role,
  group,
}: {
  action: Action;
  role: string | null;
  group: string;
}) {
  const t = useTranslations('sso');
  const te = useTranslations();
  const [state, formAction, , formRef] = useStepUpActionState(action, { kind: 'idle' } as SsoFormState);
  const error = useErrorText()(state);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1">
      <Select
        name="role"
        label={t('groupRoleLabel', { group })}
        fieldSize="sm"
        defaultValue={role ?? 'none'}
        submitOnChange
        options={[
          { value: 'none', label: t('noRole'), text: t('noRole') },
          ...SSO_ROLE_KEYS.map((r) => ({
            value: r,
            label: te(`roles.${r}` as 'roles.viewer'),
            text: te(`roles.${r}` as 'roles.viewer'),
          })),
        ]}
      />
      <div aria-live="polite">
        {error ? <Alert title={error} /> : null}
        {state.kind === 'saved' ? (
          <p role="status" className="text-caption">
            {t('groupRoleSaved')}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** A value to copy into the IdP's settings. */
export function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  const t = useTranslations('sso');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Input id={id} label={label} value={value} readOnly spellCheck={false} className="grow font-mono" />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="sm:mb-6"
        aria-describedby={id}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}

/**
 * The SCIM token: create (or rotate, which ends the old one), shown exactly once; revoke.
 * Both need step-up.
 */
export function ScimTokenPanel({
  create,
  revoke,
  hasToken,
}: {
  create: (prev: TokenState, form: FormData) => Promise<TokenState>;
  revoke: (prev: TokenState, form: FormData) => Promise<TokenState>;
  hasToken: boolean;
}) {
  const t = useTranslations('sso');
  const te = useTranslations();
  const [made, createAction, creating, createRef] = useStepUpActionState(create, {
    kind: 'idle',
  } as TokenState);
  const [gone, revokeAction, revoking, revokeRef] = useStepUpActionState(revoke, {
    kind: 'idle',
  } as TokenState);
  const shown = useRef<string | null>(null);
  if (made.kind === 'created') shown.current = made.token;
  const error = made.kind === 'error' ? made.code : gone.kind === 'error' ? gone.code : null;
  return (
    <div className="flex flex-col gap-3">
      {made.kind === 'created' ? (
        <div role="status" className="flex flex-col gap-2">
          <Alert tone="info" title={t('tokenShownOnce')} />
          <CopyField id="scim-token" label={t('tokenLabel')} value={made.token} />
        </div>
      ) : null}
      {gone.kind === 'revoked' ? (
        <p role="status" className="text-body font-medium">
          {t('tokenRevoked')}
        </p>
      ) : null}
      {error ? (
        <div aria-live="polite">
          <Alert title={te(errorMessageKey(error))} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <form ref={createRef} action={createAction}>
          <Button type="submit" variant={hasToken ? 'secondary' : 'primary'} disabled={creating}>
            {hasToken ? t('rotateToken') : t('createToken')}
          </Button>
        </form>
        {hasToken ? (
          <form ref={revokeRef} action={revokeAction}>
            <Button type="submit" variant="danger" disabled={revoking}>
              {t('revokeToken')}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
