/** Explicit live email configuration also applies when running the app locally. */
export function sendLiveAuthMail(production: boolean, emailProvider: string | undefined): boolean {
  return production || emailProvider === 'ses';
}
