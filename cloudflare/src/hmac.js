/* Shared WebCrypto helpers for session-token signing (HMAC-SHA256 + base64).
 * Extracted so both the legacy auth.js and the v2 auth_v2.js sign identically —
 * same byte format as the old Apps Script Utilities.* calls, so copying the old
 * SESSION_SECRET keeps tokens cross-compatible.
 */

// base64 of a string's UTF-8 bytes (matches Utilities.base64Encode(str, UTF_8)).
export function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64decodeToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// base64(HMAC_SHA256(secret, payload)) — matches Utilities.computeHmacSha256Signature.
export async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
