import 'server-only';
import { type BrandKitDto, creditBalanceQuery, listBrandKitsQuery, TONES, type Tone } from '@yayatoh/ai';
import { type Ctx, executeQuery, isDomainError } from '@yayatoh/kernel';
import type { AiComposeResult, AiComposeSetup } from '@/lib/ai-compose.ts';
import { aiDrafter } from '@/server/ai.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

/**
 * M6.12b: run one AI call for a console page. Bursts are rate limited per device and per member
 * (credits cap the month); the module spends and refunds the credit and checks the permission.
 * Domain errors come back as a result the panel explains.
 */
export async function aiCall<T>(
  scope: { orgId: string; userId: string; key: string },
  run: () => Promise<{ value: T; balance: number | null }>,
): Promise<AiComposeResult<T>> {
  const limit = await limitAction('aiDraft', { identity: `${scope.orgId}:${scope.userId}:${scope.key}` });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  try {
    const { value, balance } = await run();
    return { ok: true, code: null, value, ...(balance === null ? {} : { balance }) };
  } catch (err) {
    const f = failure(err);
    return {
      ok: false,
      code: f.code,
      ...(f.reason ? { reason: f.reason } : {}),
      ...(f.fields ? { fields: f.fields } : {}),
    };
  }
}

/** Browser arguments of a Server Action: checked like form fields (the module validates again). */
export function composeArgs(v: unknown): {
  tone: Tone;
  brandKitId: string | null;
  brief: string;
  eventId: string | null;
} {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const tone = TONES.includes(s('tone') as Tone) ? (s('tone') as Tone) : 'friendly';
  return { tone, brandKitId: s('brandKitId') || null, brief: s('brief'), eventId: s('eventId') || null };
}

/** What a page needs to show the AI panel: whether AI is on, the credits and the brand kits. */
export async function aiComposeSetup(ctx: Ctx): Promise<AiComposeSetup> {
  const enabled = aiDrafter() !== null;
  let kits: BrandKitDto[] = [];
  let balance = 0;
  let allowance = 0;
  try {
    kits = await executeQuery(listBrandKitsQuery, {}, ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
  }
  try {
    ({ balance, allowance } = await executeQuery(creditBalanceQuery, {}, ctx, ports));
  } catch (err) {
    if (!isDomainError(err)) throw err;
  }
  return {
    enabled,
    balance,
    allowance,
    kits: kits.map((k) => ({ id: k.id, name: k.name, tone: k.tone, isDefault: k.isDefault })),
  };
}
