'use client';

import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation.ts';

type Phase = 'waiting' | 'done' | 'slow';

/** Waits for the provider's webhook to put the organization on the paid plan, then opens it. */
export function WelcomePoll({
  slug,
  plan,
  labels,
}: {
  slug: string;
  plan: string;
  labels: { waiting: string; done: string; slow: string; open: string };
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('waiting');
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`/api/signup/status?org=${encodeURIComponent(slug)}`, { cache: 'no-store' });
        const j = (await r.json()) as { planKey: string | null };
        if (j.planKey === plan) {
          setPhase('done');
          setTimeout(() => router.push(`/o/${slug}`), 900);
          return;
        }
      } catch {
        /* try again */
      }
      if (Date.now() - started > 60_000) return setPhase('slow');
      setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [slug, plan, router]);
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="m-0 flex items-center gap-3 text-[17px] leading-relaxed text-ink-2">
        {phase === 'done' ? (
          <Check aria-hidden="true" className="size-6 shrink-0 text-ember" />
        ) : phase === 'waiting' ? (
          <Loader2
            aria-hidden="true"
            className="size-6 shrink-0 animate-spin text-ember motion-reduce:animate-none"
          />
        ) : null}
        {labels[phase]}
      </p>
      {phase !== 'waiting' ? (
        <Link
          href={`/o/${slug}`}
          className="inline-flex min-h-12 items-center self-start rounded-pill bg-ember-soft px-6 font-bold text-white"
        >
          {labels.open}
        </Link>
      ) : null}
    </div>
  );
}
