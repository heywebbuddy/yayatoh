import 'server-only';
import { recordTermConsentTx } from '@yayatoh/crm';
import { findEventTx } from '@yayatoh/events';
import { type EventNameOf, submitRegistrationFormCommand } from '@yayatoh/forms';

/** Registration form submit (M5.1b) with the crm consent ledger: checked boxes are recorded there. */
export const submitRegistrationForm = submitRegistrationFormCommand({ recordConsent: recordTermConsentTx });

/** The event's name for a respondent's page (inside the respondent's org transaction). */
export const eventNameOf: EventNameOf = async (tx, eventId) => (await findEventTx(tx, eventId))?.name ?? null;
