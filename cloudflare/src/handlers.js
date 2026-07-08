/* Request handlers — the POST actions from the old Apps Script doPost(), ported
 * one-to-one. Each returns a plain object that worker.js serialises to JSON. The
 * response shapes are identical to the old backend, so the frontend is unchanged.
 */

import { md5 } from './md5.js';
import { issueToken, verifyToken, resolvePlayer } from './auth.js';
import { lockedMatchIds } from './locks.js';
import {
  getLeague,
  getPlayer,
  playersForLeague,
  getGuesses,
  linkGroupFor,
  linkedOthers,
  normalize,
} from './db.js';

// ---- Create an account (league-password gated) ----------------------------
export async function addPlayer(env, body) {
  const lg = await getLeague(env, body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  const name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, error: 'empty' };
  if (!String((body && body.password) || '')) return { ok: false, error: 'no_password' };
  if (String((body && body.leaguePassword) || '') !== String(lg.password)) {
    return { ok: false, error: 'bad_league_password' };
  }
  if (await getPlayer(env, lg.id, name)) return { ok: false, error: 'duplicate' };

  await env.DB.prepare('INSERT INTO players (league, name, passHash) VALUES (?, ?, ?)')
    .bind(lg.id, name, md5(String(body.password)))
    .run();

  return {
    ok: true,
    league: lg.id,
    name,
    token: await issueToken(env, lg.id, name),
    players: await playersForLeague(env, lg.id),
    links: await linkedOthers(env, lg.id, name),
  };
}

// ---- Authenticate a returning player --------------------------------------
export async function authPlayer(env, body) {
  const lg = await getLeague(env, body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  const pw = String((body && body.password) || '');
  if (!pw) return { ok: false, error: 'no_password' };
  const p = await getPlayer(env, lg.id, String((body && body.name) || '').trim());
  if (!p) return { ok: false, error: 'not_joined' };
  if (p.hash !== md5(pw)) return { ok: false, error: 'bad_password' };
  return {
    ok: true,
    league: lg.id,
    name: p.name,
    token: await issueToken(env, lg.id, p.name),
    links: await linkedOthers(env, lg.id, p.name),
  };
}

// ---- Resume a saved session (sliding expiry) ------------------------------
export async function resumeSession(env, token) {
  const t = await verifyToken(env, token);
  if (!t) return { ok: false, error: 'expired' };
  const p = await getPlayer(env, t.league, t.name);
  if (!p) return { ok: false, error: 'not_joined' };
  return {
    ok: true,
    league: t.league,
    name: p.name,
    token: await issueToken(env, t.league, p.name),
    links: await linkedOthers(env, t.league, p.name),
  };
}

// ---- Switch to a LINKED account without its password ----------------------
export async function switchLink(env, body) {
  const t = await verifyToken(env, body && body.token);
  if (!t) return { ok: false, error: 'expired' };
  const lg = await getLeague(env, body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  const name = String((body && body.name) || '').trim();
  const group = await linkGroupFor(env, t.league, t.name);
  const inGroup = group.some(
    (x) => normalize(x.league) === normalize(lg.id) && normalize(x.name) === normalize(name),
  );
  if (!inGroup) return { ok: false, error: 'not_linked' };
  const p = await getPlayer(env, lg.id, name);
  if (!p) return { ok: false, error: 'not_joined' };
  return {
    ok: true,
    league: lg.id,
    name: p.name,
    token: await issueToken(env, lg.id, p.name),
    links: await linkedOthers(env, lg.id, p.name),
  };
}

// ---- Read the caller's (privacy-filtered) guesses -------------------------
// The caller's OWN picks (any state) plus everyone's picks for LOCKED games,
// scoped to the caller's league. Unplayed games stay private.
export async function getGuessesFor(env, body) {
  const p = await resolvePlayer(env, body);
  if (!p) return { ok: false, error: 'unauthorized' };
  const locked = (await lockedMatchIds(env)) || {}; // {} when unknown → only own picks
  const mine = normalize(p.name);
  const all = await getGuesses(env, p.league);
  const out = all.filter((g) => normalize(g.player) === mine || locked[String(g.matchId)]);
  return { ok: true, league: p.league, guesses: out };
}

// ---- Save picks (auth-gated, league-scoped, mirrored to linked players) ----
// Picks for LOCKED games are dropped server-side (counted in `rejected`); existing
// picks for them are left untouched. Saved for the caller AND any linked players.
export async function savePicks(env, body) {
  const guesses = body.guesses || [];

  const p = await resolvePlayer(env, body);
  if (!p) return { ok: false, error: 'bad_password' };

  // Never accept a pick for a game that's already locked (scored / kicked off).
  const locked = (await lockedMatchIds(env)) || {};
  const accepted = guesses.filter((g) => !locked[String(g.matchId)]);
  const rejected = guesses.length - accepted.length;

  // Validate / normalise once, then reuse for the player AND any linked players.
  const clean = [];
  for (const g of accepted) {
    if (g.home === '' || g.away === '' || g.home == null || g.away == null) continue;
    const pen = g.penaltyWinner === 'home' || g.penaltyWinner === 'away' ? g.penaltyWinner : '';
    clean.push({ matchId: String(g.matchId), home: Number(g.home), away: Number(g.away), pen });
  }

  const targets = await linkGroupFor(env, p.league, p.name);
  const now = new Date().toISOString();

  // One INSERT OR REPLACE per (target, pick): the (league, player, matchId) PK
  // makes this an upsert — it overwrites that player's earlier pick for the match
  // and leaves every other pick (incl. locked games) untouched, exactly like the
  // old remove-then-append. Running them as a D1 batch = one atomic transaction,
  // so concurrent submits (double-click, two linked sessions) can't interleave.
  const stmt = env.DB.prepare(
    'INSERT OR REPLACE INTO guesses (league, ts, player, matchId, guessHome, guessAway, penaltyWinner) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const batch = [];
  for (const target of targets) {
    for (const g of clean) {
      batch.push(stmt.bind(target.league, now, target.name, g.matchId, g.home, g.away, g.pen));
    }
  }
  if (batch.length) await env.DB.batch(batch);

  // `saved` is the caller's own pick count; `linked` = how many others also got them.
  return { ok: true, saved: clean.length, rejected, linked: targets.length - 1 };
}
