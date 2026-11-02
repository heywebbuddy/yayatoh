import { describe, expect, it } from 'vitest';
import { AiOutputError } from '../src/domain/compose.ts';
import { cleanInsights, insightCredits } from '../src/domain/insights.ts';
import { AI_PURPOSES } from '../src/domain/ledger.ts';
import { AI_ROUTES, costMicros, hasRefusalFallback, purposeDisabled } from '../src/domain/routes.ts';
import { cleanSupportAssist } from '../src/domain/support-assist.ts';
import { cleanTranslation, countWords, translateCredits } from '../src/domain/translate.ts';
import { anthropicDrafter, fakeDrafter } from '../src/drafter.ts';
import { aiCallScope } from '../src/usage.ts';

const answers = [
  { id: 'a1', text: 'Great sound but the bar queue was long.', rating: 4 },
  { id: 'a2', text: 'Parking was a mess.', rating: 2 },
];

describe('routes', () => {
  it('has a route for every purpose', () => {
    for (const p of AI_PURPOSES) expect(AI_ROUTES[p]?.model).toBeTruthy();
  });
  it('prices a call from its tokens', () => {
    expect(costMicros('claude-opus-5-5', { input: 2000, cacheRead: 0, output: 1000 })).toBe(28_000);
    expect(costMicros('claude-haiku-5-5', { input: 2000, cacheRead: 0, output: 1000 })).toBe(700);
    expect(costMicros('fake', { input: 100, cacheRead: 0, output: 50 })).toBe(0);
  });
  it('switches off only the purposes named', () => {
    expect(purposeDisabled('translate', 'insights, translate')).toBe(true);
    expect(purposeDisabled('assistant', 'insights, translate')).toBe(false);
    expect(purposeDisabled('assistant', undefined)).toBe(false);
  });
  it('has no refusal fallback on Haiku', () => {
    expect(hasRefusalFallback('claude-haiku-5-5')).toBe(false);
    expect(hasRefusalFallback('claude-sonnet-5-5')).toBe(true);
  });
});

/** A client that records the request and answers as told. */
function stubClient(stopReason = 'end_turn') {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: Record<string, unknown>) => {
          requests.push(req);
          return {
            model: req.model,
            stop_reason: stopReason,
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
            content: [{ type: 'text', text: '{"ok":true}' }],
          };
        },
      },
    },
  };
  return { requests, client: client as never };
}

const REQUEST = {
  task: 'translate',
  locale: 'fr',
  tone: 'formal',
  brand: null,
  orgName: '',
  brief: '',
  targetLocale: 'fr',
  segments: { title: 'Hello' },
} as const;

describe('the Anthropic adapter on a route', () => {
  it('uses the route, reports usage, and sends a fallback only where one exists', async () => {
    const { requests, client } = stubClient();
    const drafter = anthropicDrafter({ apiKey: 'test', client });
    let reported: unknown = null;
    for (const purpose of ['insights', 'translate'] as const)
      await aiCallScope.run({ route: AI_ROUTES[purpose], report: (u) => (reported = u) }, () =>
        drafter.compose(REQUEST),
      );
    expect(requests[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'medium' } });
    expect(requests[0]).not.toHaveProperty('fallbacks');
    expect(requests[1]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
    expect(reported).toEqual({
      model: 'claude-sonnet-5-5',
      input: 10,
      cacheRead: 2,
      output: 5,
      refused: false,
    });
  });
  it('lets AI_MODEL override every route', async () => {
    const { requests, client } = stubClient();
    const drafter = anthropicDrafter({ apiKey: 'test', client, model: 'claude-opus-5-5' });
    await aiCallScope.run({ route: AI_ROUTES.insights, report: () => {} }, () => drafter.compose(REQUEST));
    expect(requests[0]).toMatchObject({ model: 'claude-opus-5-5' });
  });
  it('reports a refusal, and the reply is unusable', async () => {
    const { client } = stubClient('refusal');
    const drafter = anthropicDrafter({ apiKey: 'test', client });
    let refused = false;
    await expect(
      aiCallScope.run({ route: AI_ROUTES.insights, report: (u) => (refused = u.refused ?? false) }, () =>
        drafter.compose(REQUEST),
      ),
    ).rejects.toBeInstanceOf(AiOutputError);
    expect(refused).toBe(true);
  });
});

describe('insights', () => {
  it('shows the answers’ own words, whatever the reply claims', () => {
    const r = cleanInsights(
      JSON.stringify({
        summary: 'Good music, poor parking.',
        sentiment: 'mixed',
        themes: [
          { title: 'Parking', mentions: 1, quotes: ['a2', 'a99'] },
          { title: 'Invented', mentions: 40, quotes: ['a99'] },
        ],
      }),
      answers,
    );
    expect(r.themes).toEqual([{ title: 'Parking', mentions: 1, quotes: ['Parking was a mess.'] }]);
  });
  it('caps a theme’s count at the answers read, and an unknown sentiment is mixed', () => {
    const r = cleanInsights(
      JSON.stringify({
        summary: 'x',
        sentiment: 'furious',
        themes: [{ title: 'T', mentions: 900, quotes: ['a1'] }],
      }),
      answers,
    );
    expect(r.sentiment).toBe('mixed');
    expect(r.themes[0]?.mentions).toBe(2);
  });
  it('refuses a reply with no summary', () => {
    expect(() => cleanInsights('{"summary":"  "}', answers)).toThrow(AiOutputError);
  });
  it('charges by started hundred, at most 5', () => {
    expect([1, 100, 101, 500, 5000].map(insightCredits)).toEqual([1, 1, 2, 5, 5]);
  });
});

describe('support assist', () => {
  it('keeps labels to the fixed lists, and strips links and markup from the draft', () => {
    const r = cleanSupportAssist(
      JSON.stringify({
        category: 'wire money now',
        urgency: 'critical',
        summary: 'Wants a refund',
        draft: 'Hello <b>there</b>, see https://evil.example/pay for details.',
      }),
    );
    expect(r.category).toBe('other');
    expect(r.urgency).toBe('normal');
    expect(r.draft).toBe('Hello there, see for details.');
  });
  it('refuses an empty draft', () => {
    expect(() => cleanSupportAssist('{"draft":""}')).toThrow(AiOutputError);
  });
});

describe('translation', () => {
  const source = {
    title: 'Hello {{first_name}}',
    body: '**Read** the [guide](https://example.com/guide).',
    empty: '',
  };
  const reply = (segments: Record<string, string>) => JSON.stringify({ segments });
  it('accepts a faithful translation and leaves empty text empty', () => {
    expect(
      cleanTranslation(
        reply({
          title: 'Bonjour {{first_name}}',
          body: '**Lisez** le [guide](https://example.com/guide).',
        }),
        source,
      ),
    ).toEqual({
      title: 'Bonjour {{first_name}}',
      body: '**Lisez** le [guide](https://example.com/guide).',
      empty: '',
    });
  });
  it.each([
    ['a lost merge field', { title: 'Bonjour', body: '[g](https://example.com/guide)' }],
    ['a translated merge field', { title: 'Bonjour {{prenom}}', body: '[g](https://example.com/guide)' }],
    ['a changed link', { title: 'Bonjour {{first_name}}', body: '[g](https://evil.example/)' }],
    ['a missing segment', { title: 'Bonjour {{first_name}}' }],
  ])('refuses %s', (_name, segments) => {
    expect(() => cleanTranslation(reply(segments), source)).toThrow(AiOutputError);
  });
  it('counts words and charges by started thousand', () => {
    expect(countWords({ a: 'one two', b: ' three ', c: '' })).toBe(3);
    expect([1, 1000, 1001].map(translateCredits)).toEqual([1, 1, 2]);
  });
});

describe('the fake provider', () => {
  it('produces replies the cleaners accept, and reports usage', async () => {
    let reported = 0;
    const base = { locale: 'en', tone: 'formal', brand: null, orgName: '', brief: '' } as const;
    await aiCallScope.run({ route: AI_ROUTES.insights, report: () => reported++ }, async () => {
      const insights = await fakeDrafter.compose({ ...base, task: 'insights', subject: 'reviews', answers });
      expect(cleanInsights(insights, answers).themes[0]?.quotes[0]).toBe(answers[0]?.text);
      const assist = await fakeDrafter.compose({
        ...base,
        task: 'support_assist',
        kind: 'conversation',
        eventName: null,
        messages: [{ from: 'customer', body: 'I want my money back today' }],
      });
      expect(cleanSupportAssist(assist)).toMatchObject({ category: 'refund', urgency: 'high' });
      const segments = { title: 'Hello {{first_name}}' };
      const t = await fakeDrafter.compose({ ...base, task: 'translate', targetLocale: 'fr', segments });
      expect(cleanTranslation(t, segments).title).toBe('[fr] Hello {{first_name}}');
    });
    expect(reported).toBe(3);
  });
});
