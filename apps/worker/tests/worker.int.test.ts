import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../src/jobs.ts';
import { startWorker } from '../src/worker.ts';

describe('worker (pg-boss 12 on Postgres 18)', () => {
  const received: string[] = [];
  const echo = defineJob({
    name: 'platform.echo',
    scope: 'platform',
    payload: z.object({ msg: z.string() }),
    handler: async (p) => void received.push(p.msg),
  });
  let stop: (() => Promise<void>) | undefined;
  afterAll(async () => stop?.());

  it('runs a queued job through its validated handler', async () => {
    const boss = await startWorker({
      connectionString: process.env.MIGRATOR_DATABASE_URL as string,
      jobs: [echo],
    });
    stop = () => boss.stop({ graceful: false });
    await boss.send('platform.echo', { msg: 'hello' });
    const deadline = Date.now() + 15_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual(['hello']);
  });
});
