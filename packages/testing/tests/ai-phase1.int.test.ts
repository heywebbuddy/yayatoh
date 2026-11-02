import {
  AI_ROUTES,
  type AiDrafter,
  adjustCreditsCommand,
  askHelp,
  assistSupport,
  creditBalanceQuery,
  failingDrafter,
  fakeDrafter,
  refundCredits,
  reviewsInsightQuery,
  summarizeAnswers,
  surveyInsightQuery,
  translateContent,
} from '@yayatoh/ai';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/*
 * AI1: routing and the usage log, variable credits, the kill switch, saved summaries, support help
 * that changes nothing, help answers, and draft translation. The provider is the fake.
 */

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let viewer: Ctx;

const setBalance = (f: OrgFixture, balance: number) =>
  executeCommand(adjustCreditsCommand, { balance, reason: 'ai1 test' }, systemCtx(f.org.id), ports);
const balanceOf = async (f: OrgFixture) =>
  (await executeQuery(creditBalanceQuery, {}, f.ctx(), ports)).balance;

interface UsageRow {
  purpose: string;
  model: string;
  outcome: string;
  cost_micros: number;
  input_tokens: number;
  [key: string]: unknown;
}
const usageOf = (f: OrgFixture, purpose: string) =>
  withTenant(systemCtx(f.org.id), (tx) =>
    tx.execute<UsageRow>(
      sql`select purpose, model, outcome, cost_micros, input_tokens from ai.usage where purpose = ${purpose} order by id`,
    ),
  );

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
  }
}

const answers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, text: `Answer number ${i + 1}`, rating: 4 }));
const summary = (subjectId: string, n = 2) => ({
  subject: 'reviews' as const,
  subjectId,
  eventId,
  answers: answers(n),
  total: n,
  locale: 'en',
});

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const ev = await executeCommand(
    createEventCommand,
    {
      name: 'AI1 event',
      slug: `ai1-${uuidv7().slice(-8)}`,
      timezone: 'UTC',
      startsAt: '2030-01-01T10:00:00Z',
      endsAt: '2030-01-01T12:00:00Z',
      currency: 'USD',
    },
    a.ctx(),
    ports,
  );
  eventId = ev.id;
  const viewerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: viewerId, role: 'viewer' }, a.ctx(), ports);
  viewer = userCtx(viewerId, a.org.id);
}, 600_000);

afterAll(async () => {
  await closePools();
});

describe('routing, usage and credits', () => {
  it('writes one usage row per call, with the model, tokens and outcome', async () => {
    await setBalance(a, 50);
    const before = (await usageOf(a, 'support_assist')).length;
    await assistSupport(a.ctx(), ports, fakeDrafter, {
      kind: 'conversation',
      messages: [{ from: 'customer', body: 'Where are my tickets?' }],
    });
    const rows = await usageOf(a, 'support_assist');
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ model: 'fake', outcome: 'ok', input_tokens: 100, cost_micros: 0 });
  });

  it('records a failed call and refunds every credit of it, once', async () => {
    await setBalance(a, 50);
    const code = await codeOf(summarizeAnswers(a.ctx(), ports, failingDrafter, summary(uuidv7(), 250)));
    expect(code).toBe('invalid_state:ai_unavailable');
    expect(await balanceOf(a)).toBe(50);
    const rows = await usageOf(a, 'insights');
    expect(rows.at(-1)).toMatchObject({ outcome: 'unavailable', model: AI_ROUTES.insights.model });
  });

  it('charges by the size of the work', async () => {
    await setBalance(a, 50);
    await summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(uuidv7(), 250));
    expect(await balanceOf(a)).toBe(47);
  });

  it('refuses when the balance can’t cover the work, spending nothing', async () => {
    await setBalance(a, 1);
    const code = await codeOf(summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(uuidv7(), 250)));
    expect(code).toBe('invalid_state:out_of_credits');
    expect(await balanceOf(a)).toBe(1);
  });

  it('a disabled purpose spends and calls nothing', async () => {
    await setBalance(a, 10);
    process.env.AI_DISABLED_PURPOSES = 'translate';
    try {
      const code = await codeOf(
        translateContent(a.ctx(), ports, fakeDrafter, { targetLocale: 'fr', segments: { t: 'Hello' } }),
      );
      expect(code).toBe('invalid_state:ai_unavailable');
      expect(await balanceOf(a)).toBe(10);
    } finally {
      delete process.env.AI_DISABLED_PURPOSES;
    }
  });

  it('the app can’t change a usage row', async () => {
    const code = await withTenant(systemCtx(a.org.id), (tx) => tx.execute(sql`delete from ai.usage`)).then(
      () => 'deleted',
      () => 'refused',
    );
    expect(code).toBe('refused');
  });
});

describe('summaries', () => {
  it('saves a summary, and unchanged answers cost nothing the second time', async () => {
    await setBalance(a, 10);
    const subjectId = uuidv7();
    const first = await summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(subjectId));
    expect(first.cached).toBe(false);
    expect(first.result.themes[0]?.quotes[0]).toBe('Answer number 1');
    expect(await balanceOf(a)).toBe(9);
    const again = await summarizeAnswers(a.ctx(), ports, failingDrafter, summary(subjectId));
    expect(again.cached).toBe(true);
    expect(await balanceOf(a)).toBe(9);
  });

  it('changed answers make a new summary in the same row', async () => {
    await setBalance(a, 10);
    const subjectId = uuidv7();
    await summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(subjectId, 2));
    const changed = await summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(subjectId, 3));
    expect(changed.cached).toBe(false);
    const saved = await executeQuery(reviewsInsightQuery, { subjectId }, a.ctx(), ports);
    expect(saved?.basedOn).toBe(3);
  });

  it('another org sees nothing', async () => {
    await setBalance(a, 10);
    const subjectId = uuidv7();
    await summarizeAnswers(a.ctx(), ports, fakeDrafter, summary(subjectId));
    expect(await executeQuery(reviewsInsightQuery, { subjectId }, b.ctx(), ports)).toBeNull();
    expect(await executeQuery(surveyInsightQuery, { subjectId }, a.ctx(), ports)).toBeNull();
  });
});

describe('support help', () => {
  it('needs the feature’s own permission', async () => {
    await setBalance(a, 10);
    const req = {
      kind: 'refund_request' as const,
      messages: [{ from: 'customer' as const, body: 'Refund me' }],
    };
    expect(await codeOf(assistSupport(viewer, ports, fakeDrafter, req))).toMatch(/forbidden|not_member/);
    expect(await balanceOf(a)).toBe(10);
    expect(refundCredits.spend.name).toBeTruthy();
  });

  it('never sends what another org could see', async () => {
    await setBalance(a, 10);
    const seen: string[] = [];
    const recording: AiDrafter = {
      ...fakeDrafter,
      compose: (r) => {
        seen.push(JSON.stringify(r));
        return fakeDrafter.compose(r);
      },
    };
    await assistSupport(a.ctx(), ports, recording, {
      kind: 'conversation',
      messages: [{ from: 'customer', body: 'Only this text' }],
    });
    expect(seen.join()).toContain('Only this text');
    expect(seen.join()).not.toContain(b.org.id);
  });
});

describe('help answers', () => {
  const sources = [{ id: 's1', label: 'Refunds', text: 'Open the order and choose refund.' }];

  it('answers from the articles it was given, from the org’s credits, without a member', async () => {
    await setBalance(a, 10);
    const r = await askHelp(createCtx({ orgId: a.org.id }), ports, fakeDrafter, {
      question: 'How do I refund an order?',
      sources,
    });
    expect(r.known).toBe(true);
    expect(r.sourceIds).toEqual(['s1']);
    expect(await balanceOf(a)).toBe(9);
  });

  it('says so when they don’t cover the question', async () => {
    await setBalance(a, 10);
    const r = await askHelp(createCtx({ orgId: a.org.id }), ports, fakeDrafter, {
      question: 'zzzz qqqq xxxx',
      sources,
    });
    expect(r.known).toBe(false);
  });
});

describe('translation', () => {
  it('returns text and keeps merge fields; too long is refused before spending', async () => {
    await setBalance(a, 10);
    const r = await translateContent(a.ctx(), ports, fakeDrafter, {
      targetLocale: 'ar',
      segments: { title: 'Hello {{first_name}}', empty: '' },
    });
    expect(r.segments).toEqual({ title: '[ar] Hello {{first_name}}', empty: '' });
    expect(await balanceOf(a)).toBe(9);
    const code = await codeOf(
      translateContent(a.ctx(), ports, fakeDrafter, {
        targetLocale: 'ar',
        segments: { body: 'word '.repeat(2001) },
      }),
    );
    expect(code).toBe('invalid_state:too_long');
    expect(await balanceOf(a)).toBe(9);
  });
});
