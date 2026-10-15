import { type StepUpMethod, type StepUpProof, useCore, useSession } from '@yayatoh/mobile-core';
import { Stack as Header, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useOutcomeText } from '../../auth/outcomes';
import { replace } from '../../auth/routes';
import { useAccountFlow } from '../../auth/session-gate';
import { Body, Button, Card, ErrorText, Field, Heading, Screen, Stack, SubHeading } from '../../auth/ui';

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();

type Stage = 'info' | 'verify';

/**
 * Account deletion (App Review 5.1.1(v)): say what goes and what organizers keep, confirm it is the
 * person (step-up) and the address, delete, then sign out and wipe the phone.
 */
export default function DeleteAccount() {
  const t = useTranslations('account.delete');
  const text = useOutcomeText();
  const core = useCore();
  const router = useRouter();
  const session = useSession();
  const accountFlow = useAccountFlow();
  const [stage, setStage] = useState<Stage>('info');
  const [method, setMethod] = useState<StepUpMethod | null>(null);
  const [proof, setProof] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [errors, setErrors] = useState<{ proof?: string; email?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  if (session.status !== 'signedIn') return null;
  const email = session.user.email;

  const begin = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const started = await core.signIn.startStepUp();
      if (started.kind === 'method') {
        setMethod(started.method);
        setStage('verify');
      } else {
        setProblem(t('unavailable'));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const next: { proof?: string; email?: string } = {};
    if (!proof.trim()) next.proof = t('proofRequired');
    if (norm(confirmEmail) !== norm(email))
      next.email = confirmEmail.trim() ? t('mismatch') : t('emailRequired');
    setErrors(next);
    setProblem(null);
    if (next.proof || next.email || !method) return;

    setBusy(true);
    try {
      const body: StepUpProof =
        method === 'password' ? { method, password: proof } : { method, code: proof.trim() };
      const confirmed = await core.signIn.stepUp(body);
      if (confirmed.kind === 'failed') {
        if (confirmed.reason === 'unknown') return setProblem(t('failed'));
        return setErrors({ proof: text(confirmed) ?? undefined });
      }
      if (confirmed.kind !== 'confirmed') return setProblem(text(confirmed));

      // The session ends inside this call: tell the layout that is expected.
      accountFlow.setDeleting(true);
      const result = await core.account.deleteAccount();
      if (result.kind !== 'deleted') accountFlow.setDeleting(false);
      switch (result.kind) {
        case 'deleted':
          // The session is already gone and the phone wiped; the layout lets this page through.
          return replace(router, '/account/deleted');
        case 'lastOwner':
          setBlockers(result.organizations);
          setStage('info');
          return;
        case 'stepUpRequired':
          return setProblem(t('stepUpExpired'));
        case 'rateLimited':
          return setProblem(text({ kind: 'rateLimited', retryAfterSeconds: result.retryAfterSeconds }));
        case 'unavailable':
          return setProblem(text({ kind: 'unavailable' }));
        default:
          return setProblem(t('failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const proofLabel = method === 'password' ? t('passwordLabel') : t('codeLabel');
  const proofHelp =
    method === 'password'
      ? t('stepUpPassword')
      : method === 'email'
        ? t('stepUpEmail', { email })
        : t('stepUpTotp');

  return (
    <Screen edges={['left', 'right', 'bottom']} testID="delete-account-screen">
      <Header.Screen options={{ title: t('title') }} />
      <Stack gap={6}>
        <Heading>{t('title')}</Heading>
        {stage === 'info' ? (
          <Stack gap={6}>
            <Body>{t('intro')}</Body>
            <Card>
              <SubHeading>{t('deletedTitle')}</SubHeading>
              <Body muted={false}>{t('deleted1')}</Body>
              <Body muted={false}>{t('deleted2')}</Body>
              <Body muted={false}>{t('deleted3')}</Body>
            </Card>
            <Card>
              <SubHeading>{t('keptTitle')}</SubHeading>
              <Body muted={false}>{t('kept')}</Body>
            </Card>
            {blockers.length > 0 ? (
              <ErrorText testID="delete-blockers">
                {t('lastOwner', { count: blockers.length, names: blockers.join(', ') })}
              </ErrorText>
            ) : null}
            {problem ? <ErrorText testID="delete-problem">{problem}</ErrorText> : null}
            <Button
              label={t('continue')}
              variant="danger"
              onPress={() => void begin()}
              busy={busy}
              testID="delete-continue"
            />
          </Stack>
        ) : (
          <Stack gap={6}>
            <Body>{t('confirmIntro')}</Body>
            <Stack gap={3}>
              <Body muted={false} testID="delete-proof-help">
                {proofHelp}
              </Body>
              <Field
                label={proofLabel}
                testID="delete-proof"
                value={proof}
                onChangeText={(v) => {
                  setProof(v);
                  setErrors((e) => ({ ...e, proof: undefined }));
                }}
                error={errors.proof ?? null}
                secureTextEntry={method === 'password'}
                keyboardType={method === 'password' ? 'default' : 'number-pad'}
                textContentType={method === 'password' ? 'password' : 'oneTimeCode'}
                autoComplete={method === 'password' ? 'current-password' : 'one-time-code'}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Stack>
            <Stack gap={3}>
              <Body muted={false}>{t('typeEmail', { email })}</Body>
              <Field
                label={t('emailLabel')}
                testID="delete-email"
                value={confirmEmail}
                onChangeText={(v) => {
                  setConfirmEmail(v);
                  setErrors((e) => ({ ...e, email: undefined }));
                }}
                error={errors.email ?? null}
                keyboardType="email-address"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Stack>
            {problem ? <ErrorText testID="delete-problem">{problem}</ErrorText> : null}
            <Button
              label={t('submit')}
              variant="danger"
              onPress={() => void submit()}
              busy={busy}
              testID="delete-submit"
            />
            <Button
              label={t('back')}
              variant="secondary"
              onPress={() => setStage('info')}
              disabled={busy}
              testID="delete-back"
            />
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
