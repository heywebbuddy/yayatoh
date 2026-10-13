export const digest = (data: Uint8Array) => globalThis.crypto.subtle.digest('SHA-256', data);
