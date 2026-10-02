import type { StepCondition } from './journey.ts';

/** What a step's condition may look at about one person at one event, read when the step is due. */
export interface PersonFacts {
  /** A live admission (not undone) for any of their tickets at the event. */
  readonly checkedIn: boolean;
  /** A seat assigned to any of their places at the event. */
  readonly hasSeat: boolean;
  /** They answered the event's post-event survey. */
  readonly answeredSurvey: boolean;
}

/** Which facts a condition needs (only those are read). */
export function factNeeded(condition: StepCondition): keyof PersonFacts {
  switch (condition) {
    case 'checked_in':
    case 'not_checked_in':
      return 'checkedIn';
    case 'has_seat':
    case 'no_seat':
      return 'hasSeat';
    case 'answered_survey':
    case 'not_answered_survey':
      return 'answeredSurvey';
  }
}

/** Whether the step runs for this person. No condition: always. Pure. */
export function conditionHolds(condition: StepCondition | null, facts: Partial<PersonFacts>): boolean {
  if (condition === null) return true;
  const value = facts[factNeeded(condition)] === true;
  return condition.startsWith('not_') || condition === 'no_seat' ? !value : value;
}
