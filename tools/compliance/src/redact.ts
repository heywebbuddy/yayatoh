import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The evidence bundle's redaction and leak gate (M5.11a). Collectors pass every free-text field
 * through `redactText` before writing; `scanBundle` then re-reads every file of the finished
 * bundle and fails on anything that still looks like a secret or customer data. gitleaks runs
 * on the same directory in the workflow as a second, independent scanner.
 *
 * Rules are deliberately broad: a false positive fails the job and a person looks; a false
 * negative ships a secret to an auditor.
 */

export type LeakKind =
  | 'email'
  | 'github_token'
  | 'stripe_key'
  | 'aws_key'
  | 'slack_token'
  | 'private_key'
  | 'jwt'
  | 'doppler_token'
  | 'db_url_password'
  | 'bearer_token'
  | 'secret_assignment'
  | 'ipv4'
  | 'ipv6'
  | 'card_number';

interface Rule {
  readonly kind: LeakKind;
  readonly re: RegExp;
  /** Extra check on the match (Luhn, allowed ranges). False means "not a leak". */
  readonly confirm?: (match: string) => boolean;
}

/** Only the reserved `.test` TLD (RFC 2606) is allowed: seed personas and fixtures use it. */
export const isAllowedEmail = (email: string) => /\.test$/i.test(email.trim());

function luhn(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Loopback and unspecified addresses are never customer data; every other address counts. */
function isReportableIpv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.some((n) => n > 255)) return false;
  if (o[0] === 127 || ip === '0.0.0.0') return false;
  return true;
}

export const RULES: readonly Rule[] = [
  {
    kind: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    confirm: (m) => !isAllowedEmail(m),
  },
  { kind: 'github_token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'stripe_key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bwhsec_[A-Za-z0-9]{20,}\b/g },
  { kind: 'aws_key', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { kind: 'slack_token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'private_key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'doppler_token', re: /\bdp\.(?:st|pt|sa|ct|scim|audit)\.[A-Za-z0-9_.-]{20,}\b/g },
  {
    kind: 'db_url_password',
    re: /\b(?:postgres(?:ql)?|mysql|redis|rediss|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s@/]+@/g,
  },
  { kind: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  {
    kind: 'secret_assignment',
    re: /\b[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{12,}/gi,
  },
  {
    kind: 'ipv4',
    re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    confirm: isReportableIpv4,
  },
  // Full and compressed forms with at least three groups; `::1` and plain times are not matched.
  {
    kind: 'ipv6',
    re: /(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])|(?<![\w:])(?:[0-9a-f]{1,4}:){2,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])/gi,
    confirm: (m) => /[a-f]/i.test(m) || m.split(':').filter(Boolean).length >= 3,
  },
  // Not inside a longer token: a hex digest (SHA256SUMS) or an id can hold a Luhn-valid run of
  // digits (batch 3g merge: a bundle's checksum line was flagged on 2026-10-03).
  {
    kind: 'card_number',
    re: /(?<![\dA-Za-z_-])\d(?:[ -]?\d){12,18}(?![\dA-Za-z_-])/g,
    confirm: luhn,
  },
];

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly kind: LeakKind;
  /** Never the value itself: a masked preview so the report can't leak what it found. */
  readonly preview: string;
}

const mask = (s: string) => (s.length <= 6 ? '***' : `${s.slice(0, 3)}***${s.slice(-2)}`);

/** Every leak in a text, with 1-based line numbers. */
export function scanText(text: string, file = '<text>'): Finding[] {
  const out: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.confirm && !rule.confirm(m[0])) continue;
        out.push({ file, line: i + 1, kind: rule.kind, preview: mask(m[0]) });
      }
    }
  });
  return out;
}

/** Replace every leak with `[redacted:<kind>]`; allowed `.test` emails stay. */
export function redactText(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (m) => (rule.confirm && !rule.confirm(m) ? m : `[redacted:${rule.kind}]`));
  }
  return out;
}

/** Deep-redact every string in a JSON-able value (keys included). */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [redactText(k), redactValue(v)]),
    ) as T;
  }
  return value;
}

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

export interface ScanReport {
  readonly ok: boolean;
  readonly files: number;
  readonly findings: readonly Finding[];
}

/**
 * Scan every file of a bundle directory. Binary files are refused outright: the bundle holds
 * text only (JSON, YAML, Markdown, CSV), so anything else is itself a finding.
 */
export function scanBundle(dir: string): ScanReport {
  const findings: Finding[] = [];
  const all = files(dir);
  for (const f of all) {
    const rel = relative(dir, f).split(sep).join('/');
    const buf = readFileSync(f);
    if (buf.includes(0)) {
      findings.push({ file: rel, line: 0, kind: 'secret_assignment', preview: 'binary file in bundle' });
      continue;
    }
    findings.push(...scanText(buf.toString('utf8'), rel));
  }
  return { ok: findings.length === 0, files: all.length, findings };
}
