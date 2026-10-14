import { useEffect } from 'react';
import { Field, type FieldProps } from './ui';

/** Digits only, at most `length` of them: what a paste like "123 456" or an autofill gives. */
export const digitsOnly = (text: string, length = 6): string => text.replace(/\D/g, '').slice(0, length);

export interface CodeInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Called once the last digit arrives (typed, pasted or autofilled). */
  readonly onComplete?: (code: string) => void;
  readonly error?: string | null;
  readonly testID: string;
  readonly length?: number;
  readonly autoFocus?: boolean;
}

/**
 * The six-digit code field: numeric keyboard, the one-time-code hint so iOS and Android offer the
 * code from the email or message, paste cleaned to digits.
 */
export function CodeInput({
  label,
  value,
  onChange,
  onComplete,
  error,
  testID,
  length = 6,
  autoFocus,
}: CodeInputProps) {
  useEffect(() => {
    if (value.length === length) onComplete?.(value);
    // Only a change of the value completes: the callback may be a new function every render.
  }, [value, length]);

  const props: Partial<FieldProps> = {
    keyboardType: 'number-pad',
    inputMode: 'numeric',
    textContentType: 'oneTimeCode',
    autoComplete: 'sms-otp',
    autoCapitalize: 'none',
    autoCorrect: false,
    maxLength: length + 8, // room for a pasted "123 456" before it is cleaned
    ...(autoFocus ? { autoFocus } : {}),
  };
  return (
    <Field
      label={label}
      testID={testID}
      value={value}
      error={error ?? null}
      onChangeText={(text) => onChange(digitsOnly(text, length))}
      {...props}
    />
  );
}
