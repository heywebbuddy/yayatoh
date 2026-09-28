import type { EvidenceDocument } from '@yayatoh/reports';

/**
 * The evidence packet exactly as it will be sent (M1.6e), in English, for the reviewer to read
 * before submitting. Plain, printable markup; tables scroll on small screens.
 */
export function EvidencePreview({ doc, label }: { doc: EvidenceDocument; label: string }) {
  return (
    <article
      lang={doc.lang}
      dir="ltr"
      aria-label={label}
      className="flex flex-col gap-5 rounded-card border border-zinc-200 bg-white p-5"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-section">{doc.title}</h3>
        <p className="text-caption text-zinc-600">{doc.subtitle}</p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.id ?? s.title} className="flex flex-col gap-2">
          <h4 className="font-mono text-label uppercase text-zinc-500">{s.title}</h4>
          {s.rows ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[12rem_1fr]">
              {s.rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-caption text-zinc-600">{k}</dt>
                  <dd className="break-words text-body">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {s.table ? (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
            <section tabIndex={0} aria-label={s.title} className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-caption">
                <thead>
                  <tr className="border-b border-zinc-200">
                    {s.table.head.map((h) => (
                      <th key={h} scope="col" className="px-2 py-1.5 text-start font-normal text-zinc-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.body.map((r, i) => (
                    <tr key={i} className="border-b border-zinc-100">
                      {r.map((c, j) => (
                        <td key={j} className="px-2 py-1.5 align-top">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          {s.text ? <p className="whitespace-pre-wrap break-words text-body">{s.text}</p> : null}
          {s.note ? <p className="text-caption text-zinc-500">{s.note}</p> : null}
        </section>
      ))}
      <footer className="text-caption text-zinc-500">{doc.footer}</footer>
    </article>
  );
}
