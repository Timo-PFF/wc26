/* Sessions + identity — ported from the Apps Script "Sessions" section.
 *
 * A token is  base64(JSON{l,n}) . expiryMs . base64(HMAC_SHA256(secret, payload))
 * binding to (league, name). Stateless: verify = recompute the signature + check
 * expiry. The format is byte-for-byte the same as the old backend, so if you copy
 * the old SESSION_SECRET into this Worker, tokens issued by Apps Script still
 * validate here (otherwise everyone simply logs in once after cutover).
 *
 * Secret + hashing live here; the actual crypto is WebCrypto (HMAC-SHA256, native)
 * plus the bundled md5() for the legacy password hashes.
 */

import { md5 } from './md5.js';
import { getLeague, getPlayer } from './db.js';

const SESSION_DAYS = 30;

// base64 of a string's UTF-8 bytes (matches Utilities.base64Encode(str, UTF_8)).
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decodeToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// base64(HMAC_SHA256(secret, payload)) — matches Utilities.computeHmacSha256Signature.
async function sign(payload, secret) {
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

export async function issueToken(env, league, name) {
  const data = b64encodeUtf8(JSON.stringify({ l: league, n: name }));
  const payload = data + '.' + (Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return payload + '.' + (await sign(payload, env.SESSION_SECRET));
}

// { league, name } if the token's signature is valid and unexpired, else null.
export async function verifyToken(env, token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  if ((await sign(payload, env.SESSION_SECRET)) !== parts[2]) return null; // tampered / wrong secret
  if (Date.now() > Number(parts[1])) return null; // expired
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64decodeToBytes(parts[0])));
    if (!obj || !obj.l || !obj.n) return null;
    return { league: String(obj.l), name: String(obj.n) };
  } catch (e) {
    return null;
  }
}

// Identify the requesting player from a session token (preferred) or a
// league+name+password triple. Returns the { league, name, hash } record or null.
export async function resolvePlayer(env, body) {
  if (body && body.token) {
    const t = await verifyToken(env, body.token);
    return t ? getPlayer(env, t.league, t.name) : null;
  }
  const lg = await getLeague(env, body && body.league);
  if (!lg) return null;
  const p = await getPlayer(env, lg.id, String((body && (body.player || body.name)) || '').trim());
  if (!p || !p.hash || p.hash !== md5(String((body && body.password) || ''))) return null;
  return p;
}
