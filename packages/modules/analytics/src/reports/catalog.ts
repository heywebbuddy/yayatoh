/** Scheduled PDF reports (M6.2b): how often, and the states a period's run goes through. */
export const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export const REPORT_RUN_STATUSES = ['pending', 'sent', 'failed'] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];
export const MAX_RECIPIENTS = 20;
export const MAX_SCHEDULES_PER_ORG = 25;
/** A run that keeps failing stops being retried after this many attempts (the page shows it). */
export const MAX_RUN_ATTEMPTS = 5;
/** Periods missed while the worker was down are caught up, at most this many per schedule. */
export const MAX_CATCH_UP = 3;
