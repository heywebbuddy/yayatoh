import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

/**
 * The IdP settings of a connection (M6.5a), stored in `connections.idp_config`. Everything here
 * is public information about the IdP (its identifiers, URLs and signing certificate); the OIDC
 * client secret is sealed apart and never part of this object.
 */
export const SamlConfig = z.object({
  protocol: z.literal('saml'),
  entityId: z.string().trim().min(1).max(1024),
  ssoUrl: z.url({ protocol: /^https$/ }).max(2048),
  certificate: z.string().trim().min(1).max(20_000),
  metadataUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .default(null),
});
export type SamlConfig = z.infer<typeof SamlConfig>;

export const OidcConfig = z.object({
  protocol: z.literal('oidc'),
  issuer: z.url({ protocol: /^https$/ }).max(2048),
  clientId: z.string().trim().min(1).max(255),
});
export type OidcConfig = z.infer<typeof OidcConfig>;

export const IdpConfig = z.discriminatedUnion('protocol', [SamlConfig, OidcConfig]);
export type IdpConfig = z.infer<typeof IdpConfig>;

export interface ParsedMetadata {
  readonly entityId: string;
  readonly ssoUrl: string;
  readonly certificate: string;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** A base64 certificate body as PEM (64-character lines). */
export function toPem(body: string): string {
  const clean = body.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  const lines = clean.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

/**
 * Read an IdP's SAML 2.0 metadata (an `EntityDescriptor` with an `IDPSSODescriptor`): its entity
 * id, the sign-in URL (HTTP-Redirect binding preferred, else HTTP-POST) and the signing
 * certificate. Only these three values are read; DTDs and entities are refused outright (no XXE).
 * Returns the reason when the document is not usable.
 */
export function parseSamlMetadata(xml: string): ParsedMetadata | { readonly error: MetadataError } {
  if (xml.length > 200_000) return { error: 'too_large' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { error: 'invalid_metadata' };
  const descriptor = /<(?:\w+:)?EntityDescriptor\b[^>]*\bentityID\s*=\s*"([^"]+)"/i.exec(xml);
  const idp = /<(?:\w+:)?IDPSSODescriptor\b[\s\S]*?<\/(?:\w+:)?IDPSSODescriptor>/i.exec(xml);
  if (!descriptor?.[1] || !idp) return { error: 'invalid_metadata' };
  const services = [...idp[0].matchAll(/<(?:\w+:)?SingleSignOnService\b([^>]*)\/?>/gi)].map((m) => {
    const attrs = m[1] ?? '';
    return {
      binding: /\bBinding\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? '',
      location: decode(/\bLocation\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? ''),
    };
  });
  const sso =
    services.find((s) => s.binding.endsWith(':HTTP-Redirect')) ??
    services.find((s) => s.binding.endsWith(':HTTP-POST'));
  if (!sso?.location) return { error: 'no_sso_url' };
  const keys = [
    ...idp[0].matchAll(/<(?:\w+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?KeyDescriptor>/gi),
  ];
  const signing = keys.find((k) => !/\buse\s*=\s*"encryption"/i.test(k[1] ?? '')) ?? null;
  const cert = signing
    ? /<(?:\w+:)?X509Certificate>\s*([A-Za-z0-9+/=\s]+?)\s*<\/(?:\w+:)?X509Certificate>/i.exec(
        signing[2] ?? '',
      )
    : null;
  if (!cert?.[1]) return { error: 'no_certificate' };
  return { entityId: decode(descriptor[1]), ssoUrl: sso.location, certificate: toPem(cert[1]) };
}

export const METADATA_ERRORS = ['too_large', 'invalid_metadata', 'no_sso_url', 'no_certificate'] as const;
export type MetadataError = (typeof METADATA_ERRORS)[number];

export type CertificateProblem = 'certificate_invalid' | 'certificate_expired' | 'certificate_not_yet_valid';

export interface CertificateInfo {
  readonly subject: string;
  readonly validTo: Date;
  readonly fingerprint: string;
}

/** Parse a PEM (or bare base64) certificate: its subject, expiry and SHA-256 fingerprint. */
export function certificateInfo(pem: string): CertificateInfo | null {
  try {
    const cert = new X509Certificate(toPem(pem));
    return {
      subject: cert.subject.replace(/\n/g, ', '),
      validTo: new Date(cert.validTo),
      fingerprint: cert.fingerprint256,
    };
  } catch {
    return null;
  }
}

/** Why a signing certificate can't be used now, or null. */
export function certificateProblem(pem: string, now: Date): CertificateProblem | null {
  try {
    const cert = new X509Certificate(toPem(pem));
    if (new Date(cert.validTo) <= now) return 'certificate_expired';
    if (new Date(cert.validFrom) > now) return 'certificate_not_yet_valid';
    return null;
  } catch {
    return 'certificate_invalid';
  }
}
