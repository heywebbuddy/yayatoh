'use client';

import { Alert, Button, Card, Checkbox, Input, Radio, Select, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SsoFormState } from '@/app/[locale]/o/[org]/(org)/sso/actions.ts';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

export const SSO_ROLE_KEYS = [
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
] as const;

export interface ConnectionInitial {
  readonly protocol: 'saml' | 'oidc';
  readonly name: string;
  readonly defaultRole: string;
  readonly jit: boolean;
  readonly entityId: string;
  readonly ssoUrl: string;
  readonly metadataUrl: string;
  readonly issuer: string;
  readonly clientId: string;
}

/**
 * The identity provider settings (M6.5a): SAML 2.0 (the IdP's metadata as XML or a URL, or its
 * entity id, sign-in URL and certificate by hand) or OpenID Connect (issuer, client id, secret);
 * who a first sign-in becomes (default role, just-in-time provisioning). Saving needs step-up.
 */
export function ConnectionForm({
  action,
  initial,
}: {
  action: (prev: SsoFormState, form: FormData) => Promise<SsoFormState>;
  initial: ConnectionInitial | null;
}) {
  const t = useTranslations('sso');
  const te = useTranslations();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as SsoFormState);
  const [protocol, setProtocol] = useState<'saml' | 'oidc'>(initial?.protocol ?? 'saml');
  const [source, setSource] = useState<'xml' | 'url' | 'manual'>(
    initial ? (initial.metadataUrl ? 'url' : 'manual') : 'xml',
  );
  const invalid = (f: string) => state.kind === 'error' && state.fields.includes(f);
  const reasonText =
    state.kind === 'error' && state.reason
      ? t(`reasons.${state.reason}` as 'reasons.invalid_metadata')
      : null;
  const fieldError = (f: string) => (invalid(f) ? (reasonText ?? t('fieldInvalid')) : undefined);
  const editing = initial !== null;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{editing ? t('editTitle') : t('createTitle')}</h2>
      {state.kind === 'saved' ? (
        <p role="status" className="text-body font-medium">
          {t('saved')}
        </p>
      ) : null}
      {state.kind === 'error' && state.fields.length === 0 ? (
        <div aria-live="polite">
          <Alert title={reasonText ?? te(errorMessageKey(state.code))} />
        </div>
      ) : null}
      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1" disabled={editing}>
          <legend className="text-body font-semibold">{t('protocol')}</legend>
          <Radio
            name="protocol"
            value="saml"
            id="sso-protocol-saml"
            label={t('protocolSaml')}
            hint={t('protocolSamlHint')}
            checked={protocol === 'saml'}
            onChange={() => setProtocol('saml')}
          />
          <Radio
            name="protocol"
            value="oidc"
            id="sso-protocol-oidc"
            label={t('protocolOidc')}
            hint={t('protocolOidcHint')}
            checked={protocol === 'oidc'}
            onChange={() => setProtocol('oidc')}
          />
        </fieldset>
        {editing ? <input type="hidden" name="protocol" value={protocol} /> : null}
        <Input
          name="name"
          label={t('name')}
          hint={t('nameHint')}
          maxLength={80}
          defaultValue={initial?.name ?? ''}
          error={invalid('name') ? t('fieldRequired') : undefined}
          required
        />
        {protocol === 'saml' ? (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-body font-semibold">{t('samlSource')}</legend>
              <Radio
                name="samlSource"
                value="xml"
                id="sso-source-xml"
                label={t('sourceXml')}
                checked={source === 'xml'}
                onChange={() => setSource('xml')}
              />
              <Radio
                name="samlSource"
                value="url"
                id="sso-source-url"
                label={t('sourceUrl')}
                checked={source === 'url'}
                onChange={() => setSource('url')}
              />
              <Radio
                name="samlSource"
                value="manual"
                id="sso-source-manual"
                label={t('sourceManual')}
                checked={source === 'manual'}
                onChange={() => setSource('manual')}
              />
            </fieldset>
            {source === 'xml' ? (
              <Textarea
                name="metadataXml"
                label={t('metadataXml')}
                hint={t('metadataXmlHint')}
                rows={6}
                spellCheck={false}
                className="font-mono"
                error={fieldError('metadataXml')}
              />
            ) : null}
            {source === 'url' ? (
              <Input
                name="metadataUrl"
                type="url"
                inputMode="url"
                spellCheck={false}
                label={t('metadataUrl')}
                hint={t('metadataUrlHint')}
                defaultValue={initial?.metadataUrl ?? ''}
                error={fieldError('metadataUrl')}
              />
            ) : null}
            {source === 'manual' ? (
              <>
                <Input
                  name="entityId"
                  spellCheck={false}
                  label={t('entityId')}
                  defaultValue={initial?.entityId ?? ''}
                  error={fieldError('entityId')}
                />
                <Input
                  name="ssoUrl"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  label={t('ssoUrl')}
                  defaultValue={initial?.ssoUrl ?? ''}
                  error={fieldError('ssoUrl')}
                />
                <Textarea
                  name="certificate"
                  label={t('certificate')}
                  hint={t('certificateHint')}
                  rows={5}
                  spellCheck={false}
                  className="font-mono"
                  error={fieldError('certificate')}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <Input
              name="issuer"
              type="url"
              inputMode="url"
              spellCheck={false}
              label={t('issuer')}
              hint={t('issuerHint')}
              defaultValue={initial?.issuer ?? ''}
              error={fieldError('issuer')}
            />
            <Input
              name="clientId"
              spellCheck={false}
              label={t('clientId')}
              defaultValue={initial?.clientId ?? ''}
              error={fieldError('clientId')}
            />
            <Input
              name="clientSecret"
              type="password"
              autoComplete="off"
              label={t('clientSecret')}
              hint={editing ? t('clientSecretKeep') : undefined}
              error={invalid('clientSecret') ? t('fieldRequired') : undefined}
            />
          </>
        )}
        <Select
          name="defaultRole"
          label={t('defaultRole')}
          hint={t('defaultRoleHint')}
          defaultValue={initial?.defaultRole ?? 'viewer'}
          options={SSO_ROLE_KEYS.map((r) => ({
            value: r,
            label: te(`roles.${r}` as 'roles.viewer'),
            text: te(`roles.${r}` as 'roles.viewer'),
          }))}
        />
        <Checkbox name="jit" label={t('jit')} hint={t('jitHint')} defaultChecked={initial?.jit ?? true} />
        <Button type="submit" disabled={pending} className="self-start">
          {editing ? t('saveChanges') : t('saveConnection')}
        </Button>
      </form>
    </Card>
  );
}
