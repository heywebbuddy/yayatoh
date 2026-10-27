/**
 * What a public page shows while its data loads: the page's bar, a heading block and a grid of
 * poster-shaped placeholders in the same boxes the real cards use, so nothing shifts when it
 * arrives. Decorative: the page announces itself when it is ready.
 */
export function PageSkeleton() {
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page" aria-busy="true">
      <div className="px-3 pt-3 sm:px-5">
        <div className="mx-auto h-14 max-w-7xl animate-pulse rounded-pill border border-line bg-surface" />
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pt-14 md:px-6">
        <div className="h-14 w-2/3 max-w-xl animate-pulse rounded-card bg-surface-2" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <div key={i} className="flex flex-col gap-3">
              <div className="aspect-square animate-pulse rounded-card bg-surface-2" />
              <div className="h-3 w-1/2 animate-pulse rounded-pill bg-surface-2" />
              <div className="h-4 w-4/5 animate-pulse rounded-pill bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
