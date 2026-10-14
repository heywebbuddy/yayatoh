# M7.1a — Universal crypto and test vectors (done)

The door's decisions (is this code genuine, is this person let in) depend on `@yayatoh/ticket-crypto` and `@yayatoh/checkin-engine`. The Scan PWA runs them in browsers; the Staff app will run them on Hermes, which has no `crypto.subtle`. This increment changes **how** they compute, never **what** they decide.

## What was built
- **Pure-JavaScript crypto.** Ed25519 and SHA-256 now come from `@noble/curves` and `@noble/hashes` (exact versions in the pnpm catalog), wrapped once in `packages/ticket-crypto/src/primitives.ts` (`ed25519Verify`, `ed25519Sign`, `ed25519KeyPair`, `ed25519KeyPairFromSeed`, `sha256Hex`). Verification is strict RFC 8032 (`zip215: false`), as Web Crypto's was, and never throws on a wrong-length key or signature. Exported functions keep their names and signatures (still `async`), so no caller changed: `verifyTicketCode`, `signTicketCode`, `verifyStatement`, `signStatement`, `generateKeyPair`, `legacyPayloadHash` and `lookupHash`. Private keys stay PKCS#8, so keys already in the vault keep working. Server signing in `packages/modules/ticketing/src/issue.ts` is untouched.
- **Fixed test vectors**, committed as JSON and reproduced exactly by a test (they cannot change silently):
  - `packages/ticket-crypto/vectors/`: `ticket-codes.json` (34: valid codes for kids 1, 2, 7 and 65535; valid codes at several `rev`s; tampered signature, `rev`, ticket id and key id; non-canonical signature; unknown key id; unknown version; malformed input; the superseded-`rev` verdict is in `verdicts.json`), `statements.json` (13 signed statements), `legacy.json` (21 payload forms and 7 hashes), `primitives.json` (SHA-256, Ed25519 RFC 8032 and base32 known answers).
  - `packages/checkin-engine/vectors/`: `verdicts.json` (69 scenarios over 7 manifests: every ADR 0011 verdict row, provisional-admit and reject policies, event rules, zones, occurrences, sessions, legacy, short codes, manifest v1), `lookup.json` (email and E.164 phone normalization and search), `first-wins.json` (clock offsets and arrival races), `scopes.json` (17 signed manifest scopes).
  - Every signature and digest in them comes from Node's OpenSSL, and every expectation is a literal written from ADR 0011, never the package's own output. Fixed seeds: `seed = SHA-256('yayatoh-test-vector-key:' + label)`. Regenerate with `pnpm --filter @yayatoh/ticket-crypto vectors:write` and `pnpm --filter @yayatoh/checkin-engine vectors:write`.
- **check-modules rule `universal-crypto`:** a universal package (`yayatoh.kind: universal`) may not reference `subtle` outside comments and tests. Canary fixtures in `tools/check-modules/canaries/universal-crypto/`.
- **Benchmark:** `pnpm --filter @yayatoh/checkin-engine bench` (`packages/checkin-engine/tests/bench.ts`).

## Benchmark (Node 24.21, linux/x64, 2000 distinct signed codes after 200 warm-up)
| Operation | mean | p50 | p95 | p99 | codes/s |
|---|---|---|---|---|---|
| `verifyTicketCode` (pure JS) | 1.83 ms | 1.60 ms | 2.84 ms | 3.32 ms | 545 |
| `offlineVerdict`, admit path (verify + lookup + rules) | 2.12 ms | 1.76 ms | 3.13 ms | 3.86 ms | 472 |
| Web Crypto verify (reference, the old code) | 0.25 ms | 0.20 ms | 0.41 ms | 0.48 ms | 4068 |
| `lookupHash` (email) | 0.005 ms | | | | |
| `legacyPayloadHash` | 0.003 ms | | | | |

Pure JavaScript is about 7× slower than Node's native verifier, and still about 2 ms per code on a server CPU. A scan verdict is dominated by the signature check. M7.4b repeats the benchmark on a mid-range phone (Hermes); the plan's target is a verdict under 300 ms, with a native verifier behind the same function as the fallback if it is not met.

## Not yet / later
- Hermes timings (M7.4b, device pass).
- The Scan PWA keeps its own `crypto.subtle` use for local storage encryption and the kiosk PIN (`apps/web/src/scan/store.ts`, `kiosk-pin.ts`): the web app is not a universal package.
- `packages/sdk` verifies webhook HMACs with `crypto.subtle`. The sdk is not marked universal; M7.1b decides how the apps get HMAC if they need it.

## Pending the owner
None.

## Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | Every ticket-code vector (valid for several key ids, tampered, unknown key, unknown version) passes; signing reproduces OpenSSL's codes byte for byte | `packages/ticket-crypto/tests/vectors.test.ts` |
| AC2 | Statement, legacy-payload and primitive known-answer vectors pass (SHA-256, RFC 8032, base32) | `packages/ticket-crypto/tests/vectors.test.ts` |
| AC3 | The new code agrees with Web Crypto on keys, signatures, accept/refuse of tampered input; bad input never throws on the verify side | `packages/ticket-crypto/tests/vectors.test.ts` |
| AC4 | Every ADR 0011 verdict row, the provisional-admit policy, event rules, zones, sessions, legacy and short-code lookups give the committed verdicts | `packages/checkin-engine/tests/vectors.test.ts` |
| AC5 | Lookup hashes for email and E.164 phone normalization; first-wins with clock offsets; signed scopes | `packages/checkin-engine/tests/vectors.test.ts` |
| AC6 | Vector files equal what the generators produce (cannot change silently) | `packages/ticket-crypto/tests/vectors.test.ts`, `packages/checkin-engine/tests/vectors.test.ts` |
| AC7 | No change to any verdict: the existing offline tests pass untouched | `packages/checkin-engine/tests/offline.test.ts` |
| AC8 | A code issued by `issue.ts` verifies with the new verifier (and with Web Crypto), gives admit/duplicate verdicts, and a foreign key or tampered code is refused | `packages/testing/tests/ticket-crypto-universal.int.test.ts` |
| AC9 | `crypto.subtle` in a universal package fails `check:modules`; comments, tests and server packages pass | `tools/check-modules/tests/check.test.ts` |
| AC10 | The Scan PWA's existing specs pass unchanged on all three projects | `apps/web/e2e/scan-pwa.spec.ts`, `apps/web/e2e/scan-camera.spec.ts` |
| AC11 | A Node benchmark is recorded | `packages/checkin-engine/tests/bench.ts` (numbers above) |
| AC12 | Every vector gives the same verdict through the Hermes runtime in the Staff app | device pass (M7.4b) |
