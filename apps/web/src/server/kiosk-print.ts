import 'server-only';
import { kioskRequestCodeCommand } from '@yayatoh/badges';
import { hasWaitingRegistrationTx } from '@yayatoh/registration';

/**
 * Kiosk self-print (M5.5c), composed for the web app: the kiosk's email-code command asks the
 * registration module whether an address has a registration still waiting (registration and
 * badges share a tier, so the app wires them).
 */
export const kioskRequestCode = kioskRequestCodeCommand(hasWaitingRegistrationTx);
