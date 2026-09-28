import { Star } from 'lucide-react';

/** A 1–5 rating as stars; the visual is hidden from assistive tech, `label` is what they read. */
export function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={n <= rating ? 'size-4 fill-accent-900 text-accent-900' : 'size-4 text-zinc-300'}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}
