/** Code in the docs: verbatim, scrollable and keyboard-focusable, left-to-right in every locale. */
export function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-caption text-zinc-600">{title}</p>
      <section
        aria-label={title}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
        tabIndex={0}
        className="overflow-x-auto rounded-card border border-zinc-200 bg-white"
      >
        <pre
          dir="ltr"
          lang="en"
          className="w-max min-w-full p-4 font-mono text-caption leading-5 text-zinc-900"
        >
          <code>{code}</code>
        </pre>
      </section>
    </div>
  );
}
