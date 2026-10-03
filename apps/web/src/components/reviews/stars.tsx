import { Star } from 'lucide-react';

/** A 1–5 rating as stars; the visual is hidden from assistive tech, `label` is what they read. */
export function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={n <= rating ? 'size-4 fill-primary text-primary-ink' : 'size-4 text-ink-3'}
          strokeWidth={2}
        />
      ))}
    </span>
  );
}
