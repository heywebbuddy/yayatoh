import { RECORDED_EO_BMF_CSV } from './fixture.ts';

/**
 * The IRS exempt-organization list (M4.8b, P4-11) behind a port. Staff verify a charity profile
 * against it in the admin app: the EIN must be on the list as a 501(c)(3) (subsection `03`) to
 * which contributions are deductible (deductibility code `1`) with an exemption in force (status
 * `01`, `02` or `03`). The list is the IRS's public bulk file (EO Business Master File), downloaded
 * by an owner-run job; dev and CI use a recorded fixture in the same layout. No live calls.
 */
export interface ExemptOrgRecord {
  /** `12-3456789`. */
  readonly ein: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  /** IRC 501(c) subsection: `03` is 501(c)(3). */
  readonly subsection: string;
  /** `1`: contributions are deductible; `2`: not deductible; `4`: deductible by treaty. */
  readonly deductibility: string;
  /** Exempt-organization status: `01`–`03` in force; `12`–`25` terminated or revoked. */
  readonly status: string;
}

export interface ExemptOrgLookup {
  /** Where the list came from: the IRS bulk file, or the recorded fixture (dev/CI). */
  readonly source: 'irs_bulk' | 'fixture';
  lookup(ein: string): Promise<ExemptOrgRecord | null>;
}

/** Why a record does not make an org eligible for tax-deductible receipts (null when it does). */
export function exemptProblem(
  r: ExemptOrgRecord | null,
): 'not_listed' | 'not_501c3' | 'not_deductible' | 'not_in_force' | null {
  if (!r) return 'not_listed';
  if (r.subsection !== '03') return 'not_501c3';
  if (r.deductibility !== '1') return 'not_deductible';
  if (!['01', '02', '03'].includes(r.status)) return 'not_in_force';
  return null;
}

/** Split one CSV line (RFC 4180 quoting, as the IRS writes it). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A parser for one EO BMF file: reads the header, then maps each line to a record. */
export function eoBmfParser(header: string) {
  const cols = cells(header.trim()).map((c) => c.trim().toUpperCase());
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`EO BMF: missing column ${name}`);
    return i;
  };
  const ix = {
    ein: at('EIN'),
    name: at('NAME'),
    city: at('CITY'),
    state: at('STATE'),
    subsection: at('SUBSECTION'),
    deductibility: at('DEDUCTIBILITY'),
    status: at('STATUS'),
  };
  return (line: string): ExemptOrgRecord | null => {
    if (!line.trim()) return null;
    const c = cells(line.replace(/\r$/, ''));
    const digits = (c[ix.ein] ?? '').trim();
    if (!/^\d{9}$/.test(digits)) return null;
    return {
      ein: `${digits.slice(0, 2)}-${digits.slice(2)}`,
      name: (c[ix.name] ?? '').trim(),
      city: (c[ix.city] ?? '').trim(),
      state: (c[ix.state] ?? '').trim(),
      subsection: (c[ix.subsection] ?? '').trim(),
      deductibility: (c[ix.deductibility] ?? '').trim(),
      status: (c[ix.status] ?? '').trim(),
    };
  };
}

/** Parse a whole EO BMF file (small files: the fixture). */
export function parseEoBmf(csv: string): ExemptOrgRecord[] {
  const [header = '', ...lines] = csv.split('\n');
  const parse = eoBmfParser(header);
  return lines.map(parse).filter((r): r is ExemptOrgRecord => r !== null);
}

/** The recorded fixture as a lookup (dev, CI and e2e). */
export function recordedExemptOrgLookup(csv: string = RECORDED_EO_BMF_CSV): ExemptOrgLookup {
  const byEin = new Map(parseEoBmf(csv).map((r) => [r.ein, r]));
  return { source: 'fixture', lookup: async (ein) => byEin.get(ein) ?? null };
}

/**
 * The downloaded IRS bulk files (`eo*.csv` in `dir`, written by the owner-run job): each lookup
 * streams them line by line until the EIN turns up (a staff action, a few seconds at most).
 */
export function bulkFileExemptOrgLookup(dir: string): ExemptOrgLookup {
  return {
    source: 'irs_bulk',
    async lookup(ein) {
      const digits = ein.replace('-', '');
      const { readdir } = await import('node:fs/promises');
      const { createReadStream } = await import('node:fs');
      const { createInterface } = await import('node:readline');
      const { join } = await import('node:path');
      const files = (await readdir(dir)).filter((f) => /^eo.*\.csv$/i.test(f)).sort();
      for (const f of files) {
        const lines = createInterface({ input: createReadStream(join(dir, f), 'utf8'), crlfDelay: Infinity });
        let parse: ((line: string) => ExemptOrgRecord | null) | null = null;
        for await (const line of lines) {
          if (!parse) {
            parse = eoBmfParser(line);
            continue;
          }
          if (!line.startsWith(`"${digits}"`) && !line.startsWith(`${digits},`)) continue;
          const r = parse(line);
          if (r) {
            lines.close();
            return r;
          }
        }
      }
      return null;
    },
  };
}

/**
 * The lookup the admin app uses: the downloaded list when `IRS_EO_BMF_DIR` is set; the recorded
 * fixture in dev and CI (`YAYATOH_DEV_AUTH=1` or tests); otherwise none (staff see that the list
 * is not loaded and cannot verify).
 */
export function exemptOrgLookupFromEnv(
  env: Record<string, string | undefined> = process.env,
): ExemptOrgLookup | null {
  if (env.IRS_EO_BMF_DIR) return bulkFileExemptOrgLookup(env.IRS_EO_BMF_DIR);
  if (env.YAYATOH_DEV_AUTH === '1' || env.NODE_ENV === 'test' || env.VITEST) return recordedExemptOrgLookup();
  return null;
}
