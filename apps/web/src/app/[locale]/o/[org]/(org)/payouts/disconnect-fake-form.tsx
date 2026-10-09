'use client';

import { Button } from '@yayatoh/ui';
import type { FormEvent } from 'react';
import { StepUpForm } from '@/components/step-up.tsx';

export function DisconnectFakePayoutForm({
  action,
  label,
  confirmMessage,
}: {
  action: () => Promise<{ code: string } | undefined>;
  label: string;
  confirmMessage: string;
}) {
  const confirm = (event: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(confirmMessage)) event.preventDefault();
  };

  return (
    <StepUpForm action={action} onSubmit={confirm} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </StepUpForm>
  );
}
