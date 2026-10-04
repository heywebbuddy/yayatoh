import { buttonClass, Card, EmptyState, StatusDot } from '@yayatoh/ui';
import { Link } from '@/i18n/navigation.ts';

export interface AlertsListItem {
  readonly id: string;
  /** The alert's text in the reader's language ("37 attendees do not have seats"). */
  readonly title: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly severityLabel: string;
  /** The event, or "Whole organization". */
  readonly context: string;
  readonly stateLabel: string;
  /** Console page with the bulk action that fixes it, and its label ("Seat them"). */
  readonly fixHref: string;
  readonly fixLabel: string;
}

export const SEVERITY_DOT = { info: 'info', warning: 'warning', critical: 'danger' } as const;

/**
 * A compact list of alerts (M3.2b): the Command Center's Alerts widget (M3.2a) and the event
 * home render it with already-translated rows. Render-only: acknowledging and snoozing live on
 * the alerts page.
 */
export function AlertsList({
  title,
  items,
  emptyText,
  viewAll,
}: {
  title: string;
  items: readonly AlertsListItem[];
  emptyText: string;
  viewAll?: { href: string; label: string } | null;
}) {
  return (
    <Card className="flex flex-col gap-3" data-testid="alerts-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section">{title}</h2>
        {viewAll && items.length > 0 ? (
          <Link href={viewAll.href} className="inline-flex min-h-6 items-center text-caption underline">
            {viewAll.label}
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <EmptyState
          title={emptyText}
          // With nothing to list, the "view all" link moves here as the next step.
          action={
            viewAll ? (
              <Link href={viewAll.href} className={buttonClass('secondary', 'md')}>
                {viewAll.label}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex list-none flex-col divide-y divide-line p-0">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body text-ink">{a.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 text-caption text-ink-2">
                  <StatusDot status={SEVERITY_DOT[a.severity]} label={a.severityLabel} />
                  <span>{a.context}</span>
                  <span>{a.stateLabel}</span>
                </span>
              </span>
              <Link
                href={a.fixHref}
                className="inline-flex min-h-6 items-center text-body underline underline-offset-2"
              >
                {a.fixLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
