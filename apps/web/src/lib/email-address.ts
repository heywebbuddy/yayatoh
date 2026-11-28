/** name@domain.tld: one @, no spaces, and a dot in the domain before a TLD of 2+ characters. */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/u;

/**
 * Whether a sign-in address can be sent a code (QA #12): "nitin@gmail" is refused before any
 * email goes out. The sign-in form and the auth route use the same rule.
 */
export function isEmailAddress(value: string): boolean {
  const v = value.trim();
  return v.length <= 320 && EMAIL.test(v);
}
