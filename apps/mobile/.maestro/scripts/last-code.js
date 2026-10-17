// Maestro script: reads the last one-time code the e2e server "emailed" to EMAIL
// (GET /api/dev/last-code, which exists only while YAYATOH_DEV_AUTH is on). The code is the
// output: ${output.code}. DEV_SERVER (or MAESTRO_DEV_SERVER) is the server the build talks to, as
// the runner reaches it (a local Android emulator reaches the host as http://10.0.2.2:3000).
const base =
  typeof DEV_SERVER === 'string' && DEV_SERVER
    ? DEV_SERVER
    : typeof MAESTRO_DEV_SERVER === 'string' && MAESTRO_DEV_SERVER
      ? MAESTRO_DEV_SERVER
      : 'http://localhost:3000';
const response = http.get(`${base}/api/dev/last-code?to=${encodeURIComponent(EMAIL)}`);
output.code = json(response.body).code;
