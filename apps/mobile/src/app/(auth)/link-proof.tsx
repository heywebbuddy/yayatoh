import { useCore } from '@yayatoh/mobile-core';
import { Redirect, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { BackButton } from '../../auth/back-button';
import { CodeInput } from '../../auth/code-input';
import { useSignInFlow } from '../../auth/flow';
import { href, PATHS, replace } from '../../auth/routes';
import { Body, Button, Heading, Screen, Stack } from '../../auth/ui';
import { useOutcomeHandler } from '../../auth/use-outcome';

/**
 * Apple or Google gave an address that already has a Yayatoh account: prove it is theirs with the
 * code we emailed to that address, and the sign-in method is linked.
 */
export default function LinkProofScreen() {
  const t = useTranslations('signIn');
  const core = useCore();
  const router = useRouter();
  const flow = useSignInFlow();
  const outcome = useOutcomeHandler({ emailedCode: true });
  const [code, setCode] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = flow.pending?.step === 'emailProof' ? flow.pending : null;

  if (!pending) return <Redirect href={href(PATHS.welcome)} />;

  const submit = async (value: string) => {
    if (inFlight.current) return;
    if (value.length !== 6) return setIncomplete(true);
    setIncomplete(false);
    inFlight.current = true;
    setBusy(true);
    try {
      outcome.handle(await core.signIn.completeLinkProof(pending.challenge, value));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const startOver = () => {
    flow.reset();
    replace(router, '/welcome');
  };

  return (
    <Screen testID="link-proof-screen">
      <Stack gap={6}>
        <BackButton />
        <Stack gap={3}>
          <Heading>{t('linkProof.title')}</Heading>
          <Body>{t('linkProof.body')}</Body>
        </Stack>
        <CodeInput
          label={t('code.label')}
          testID="link-proof-input"
          value={code}
          onChange={(next) => {
            setCode(next);
            setIncomplete(false);
          }}
          onComplete={(value) => void submit(value)}
          error={incomplete ? t('code.incomplete') : outcome.message}
          autoFocus
        />
        <Button
          label={t('linkProof.submit')}
          onPress={() => void submit(code)}
          busy={busy}
          testID="link-proof-submit"
        />
        {outcome.startOver ? (
          <Button
            label={t('startAgain')}
            variant="secondary"
            onPress={startOver}
            testID="link-proof-start-over"
          />
        ) : null}
      </Stack>
    </Screen>
  );
}
