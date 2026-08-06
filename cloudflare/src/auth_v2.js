/* Sessions + identity — v2 (global users).
 *
 * A token is  base64(JSON{u,n}) . expiryMs . base64(HMAC_SHA256(secret, payload))
 * binding to (userId, name) — GLOBAL, not per-league/tournament, so one login works
 * across every tournament this Worker serves. Stateless: verify = recompute the
 * signature + check expiry.
 */

import { md5 } from './md5.js';
import { b64encodeUtf8, b64decodeToBytes, sign } from './hmac.js';
import { getUserById, getUserByName } from './db_v2.js';

const SESSION_DAYS = 30;

export async function issueToken(env, userId, name) {
  const data = b64encodeUtf8(JSON.stringify({ u: userId, n: name }));
  const payload = data + '.' + (Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return payload + '.' + (await sign(payload, env.SESSION_SECRET));
}

// { userId, name } if the token's signature is valid and unexpired, else null.
export async function verifyToken(env, token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  if ((await sign(payload, env.SESSION_SECRET)) !== parts[2]) return null; // tampered / wrong secret
  if (Date.now() > Number(parts[1])) return null; // expired
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64decodeToBytes(parts[0])));
    if (!obj || !obj.u || !obj.n) return null;
    return { userId: String(obj.u), name: String(obj.n) };
  } catch (e) {
    return null;
  }
}

// Identify the requesting user from a session token (preferred) or a
// name+password pair. Returns the { id, name, hash } user record or null.
export async function resolveUser(env, body) {
  if (body && body.token) {
    const t = await verifyToken(env, body.token);
    return t ? getUserById(env, t.userId) : null;
  }
  const u = await getUserByName(env, body && (body.name || body.player));
  if (!u || !u.hash || u.hash !== md5(String((body && body.password) || ''))) return null;
  return u;
}
