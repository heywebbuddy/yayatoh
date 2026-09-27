import { z } from 'zod';

// Runs before any app code in the browser. Zod 4 probes `new Function('')` to decide whether it
// may compile validators; under the strict CSP (no 'unsafe-eval', M1.14a) that probe is a
// violation. Jitless mode skips the probe and the compiler.
z.config({ jitless: true });
