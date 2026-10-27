import type { ProgramDocumentDto } from '@yayatoh/media';
import { FileText } from 'lucide-react';

const size = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Public PDF downloads (brochures) of a sponsor or an exhibitor. */
export function ProgramDocumentLinks({
  docs,
  heading,
}: {
  docs: readonly ProgramDocumentDto[];
  heading: string;
}) {
  if (docs.length === 0) return null;
  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <h2 className="text-section">{heading}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {docs.map((d) => (
          <li key={d.id}>
            <a
              href={d.href}
              className="inline-flex min-h-10 items-center gap-2 rounded-card border border-line px-4 py-2 text-body underline-offset-2 hover:underline"
            >
              <FileText aria-hidden="true" className="size-4 text-primary-ink" />
              <span>{d.title}</span>
              <span className="text-caption text-ink-2">PDF · {size(d.bytes)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
