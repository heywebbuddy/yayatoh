export const digest = (data: Uint8Array) => crypto.subtle.digest('SHA-256', data);
