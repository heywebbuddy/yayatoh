// Tests may compare against Web Crypto.
export const reference = (data: Uint8Array) => crypto.subtle.digest('SHA-256', data);
