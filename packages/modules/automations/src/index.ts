// M6.1a: contact merges move this module's references (ADR 0022).
export { automationsContactOwner } from './contact-merge.ts';
export { automationsDataSubjects } from './data-subject.ts';
export * from './domain/conditions.ts';
export * from './domain/journey.ts';
export * from './domain/templates.ts';
export * from './domain/timing.ts';
export {
  type ActionCounts,
  ActionDto,
  CreateJourneyInput,
  createJourneyCommand,
  deleteJourneyCommand,
  JourneyDetailDto,
  JourneySummaryDto,
  journeyQuery,
  journeyRunQuery,
  journeyRunsQuery,
  journeyStepsTx,
  listJourneysQuery,
  RUNS_PAGE,
  RunDetailDto,
  RunDto,
  RunPageDto,
  StepDto,
  setJourneyEnabledCommand,
  updateJourneyCommand,
} from './journeys.ts';
export {
  actionKey,
  cancelRunsTx,
  type Enrollment,
  enrollTx,
  eventAnchorsTx,
  journeysForEventTx,
  type RescheduleResult,
  rescheduleEventTx,
} from './lifecycle.ts';
export { privateColumns } from './private-columns.ts';
export {
  enrollEventTimeCommand,
  type RunDueResult,
  type RunnerDeps,
  recordStepFailureCommand,
  runDueActions,
  runScheduledActionCommand,
  STEP_FAILED_EVENT,
  StepFailedPayload,
} from './runner.ts';
export { ACTION_STATUSES, type ActionStatus, RUN_STATUSES } from './schema.ts';
export {
  journeyCancellations,
  journeyRescheduler,
  journeySubscribers,
  journeyTriggers,
} from './subscribers.ts';
