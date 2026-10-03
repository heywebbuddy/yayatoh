import type { PrinterAdapter } from './domain/printing.ts';

/**
 * The `BadgePrinter` port (M5.5b, P5-2). Stage 1 is the browser: the desk's own device opens the
 * badge PDF in its print dialog (AirPrint from an iPad or Mac), so "submitting" is a hand-off and
 * the service reports no printer state. Stage 2 is PrintNode (a paid cloud service with a small
 * client on a venue laptop): silent printing to any printer, and printer states for the heartbeat.
 * Dev and CI always use `fakePrintNode()`; the real adapter needs the owner's account (see
 * `docs/owner-inbox.md`) and is chosen only by `printNodeFromEnv` with an explicit provider switch.
 */
export interface PrintSubmission {
  readonly orgId: string;
  readonly printnodePrinterId: number | null;
  /** Shown in the print service's queue: event and holder, never an email. */
  readonly title: string;
  readonly pdf: Uint8Array;
  /** The print job's id: a retried submit never prints twice. */
  readonly idempotencyKey: string;
}

export type SubmitResult =
  | { readonly ok: true; readonly providerJobId: string | null }
  | { readonly ok: false; readonly code: string };

export type ReportedState = 'online' | 'offline';

export interface BadgePrinter {
  readonly adapter: PrinterAdapter;
  submit(job: PrintSubmission): Promise<SubmitResult>;
  /** What the service knows of these printers (PrintNode); missing ids are unknown to it. */
  states(orgId: string, printerIds: readonly number[]): Promise<Map<number, ReportedState>>;
}

/** Stage 1: the browser's print dialog. Nothing leaves the platform; no states are reported. */
export const browserPrinter: BadgePrinter = {
  adapter: 'browser',
  async submit() {
    return { ok: true, providerJobId: null };
  },
  async states() {
    return new Map();
  },
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * PrintNode over its REST API. One platform integrator account; each org is a child account
 * addressed by its creator reference (the org id), so no per-org secret is stored here.
 * Never called in dev or CI.
 */
export function printNodePrinter(opts: {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): BadgePrinter {
  const base = (opts.baseUrl ?? 'https://api.printnode.com').replace(/\/$/, '');
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const headers = (orgId: string) => ({
    authorization: `Basic ${Buffer.from(`${opts.apiKey}:`).toString('base64')}`,
    'content-type': 'application/json',
    'x-child-account-by-creatorref': orgId,
  });
  const signal = () => AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  return {
    adapter: 'printnode',
    async submit(job) {
      if (!job.printnodePrinterId) return { ok: false, code: 'no_printer' };
      let res: Response;
      try {
        res = await doFetch(`${base}/printjobs`, {
          method: 'POST',
          headers: { ...headers(job.orgId), 'x-idempotency-key': job.idempotencyKey },
          body: JSON.stringify({
            printerId: job.printnodePrinterId,
            title: job.title.slice(0, 100),
            contentType: 'pdf_base64',
            content: Buffer.from(job.pdf).toString('base64'),
            source: 'Yayatoh badges',
          }),
          signal: signal(),
        });
      } catch {
        return { ok: false, code: 'unreachable' };
      }
      // 409: this idempotency key was already used, so the job exists (a retry).
      if (res.status === 409) return { ok: true, providerJobId: null };
      if (!res.ok) return { ok: false, code: res.status === 404 ? 'printer_unknown' : `http_${res.status}` };
      const id = (await res.json().catch(() => null)) as unknown;
      return { ok: true, providerJobId: typeof id === 'number' ? String(id) : null };
    },
    async states(orgId, printerIds) {
      const out = new Map<number, ReportedState>();
      if (printerIds.length === 0) return out;
      const res = await doFetch(`${base}/printers/${printerIds.join(',')}`, {
        method: 'GET',
        headers: headers(orgId),
        signal: signal(),
      });
      if (!res.ok) throw new Error(`printnode: printers ${res.status}`);
      const rows = (await res.json()) as { id?: unknown; state?: unknown; computer?: { state?: unknown } }[];
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r.id !== 'number') continue;
        out.set(r.id, r.state === 'online' && r.computer?.state === 'connected' ? 'online' : 'offline');
      }
      return out;
    },
  };
}

export type FakePrinterState = ReportedState | 'rejects';

export interface FakePrintNode extends BadgePrinter {
  /** Dev/CI control: a printer's reported state (`rejects` reports online but refuses jobs). */
  setState(printerId: number, state: FakePrinterState): void;
  /** Accepted jobs, oldest first. */
  readonly jobs: readonly { id: string; orgId: string; printerId: number; title: string; bytes: number }[];
}

/**
 * The fake PrintNode (dev and CI): every printer reports online unless told otherwise, jobs are
 * accepted and numbered, a repeated idempotency key returns the first job, and a printer set to
 * `rejects` refuses jobs. Printer id 404 is unknown (refused as PrintNode would).
 */
export function fakePrintNode(): FakePrintNode {
  const states = new Map<number, FakePrinterState>();
  const jobs: { id: string; orgId: string; printerId: number; title: string; bytes: number }[] = [];
  const byKey = new Map<string, string>();
  return {
    adapter: 'printnode',
    jobs,
    setState(printerId, state) {
      states.set(printerId, state);
    },
    async submit(job) {
      const id = job.printnodePrinterId;
      if (!id || id === 404) return { ok: false, code: 'printer_unknown' };
      if (states.get(id) === 'rejects') return { ok: false, code: 'printer_rejected' };
      const prior = byKey.get(job.idempotencyKey);
      if (prior) return { ok: true, providerJobId: prior };
      const providerJobId = String(1000 + jobs.length + 1);
      jobs.push({ id: providerJobId, orgId: job.orgId, printerId: id, title: job.title, bytes: job.pdf.byteLength });
      byKey.set(job.idempotencyKey, providerJobId);
      return { ok: true, providerJobId };
    },
    async states(_orgId, printerIds) {
      const out = new Map<number, ReportedState>();
      for (const id of printerIds) {
        if (id === 404) continue;
        out.set(id, states.get(id) === 'offline' ? 'offline' : 'online');
      }
      return out;
    },
  };
}

let devFake: FakePrintNode | undefined;
/** The process's fake PrintNode (dev routes and the worker share their own process's one). */
export const devPrintNode = (): FakePrintNode => {
  devFake ??= fakePrintNode();
  return devFake;
};

/**
 * PrintNode for this process: the real adapter only with `BADGE_PRINTER_PROVIDER=printnode` and
 * `PRINTNODE_API_KEY`; the fake in dev and CI (`YAYATOH_DEV_AUTH=1`); otherwise none (PrintNode
 * printers can't be added and the page says so).
 */
export function printNodeFromEnv(env: Record<string, string | undefined> = process.env): BadgePrinter | null {
  if (env.BADGE_PRINTER_PROVIDER === 'printnode' && env.PRINTNODE_API_KEY)
    return printNodePrinter({ apiKey: env.PRINTNODE_API_KEY });
  if (env.YAYATOH_DEV_AUTH === '1' || env.NODE_ENV === 'test') return devPrintNode();
  return null;
}
