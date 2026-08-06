/* Request handlers — v2 (global users + per-tournament leagues). Each returns a
 * plain object that worker_v2.js serialises to JSON.
 *
 * Auth is global: register/login/resume/changePassword operate on the user, not a
 * league. Everything data-facing is scoped by tournamentId. A user's picks are one
 * set per tournament, shared across every league they joined (no mirroring).
 */

import { md5 } from './md5.js';
import { issueToken, verifyToken, resolveUser } from './auth_v2.js';
import { lockedMatchIds, guessScope } from './locks_v2.js';
import {
  getUserByName,
  getUserById,
  createUser,
  setPassword,
  getLeague,
  getLeaguesFull,
  getUserLeagues,
  isMember,
  addMembership,
  getLeagueMemberIds,
  getLeagueGuessesByMatches,
  getOwnGuesses,
  saveGuesses,
  normalize,
} from './db_v2.js';

// ---- Create a global account (no league yet) ------------------------------
export async function register(env, body) {
  const name = String((body && body.name) || '').trim();
  const pw = String((body && body.password) || '');
  if (!name) return { ok: false, error: 'empty' };
  if (!pw) return { ok: false, error: 'no_password' };
  if (await getUserByName(env, name)) return { ok: false, error: 'name_taken' };

  const id = crypto.randomUUID();
  await createUser(env, id, name, md5(pw));
  return { ok: true, userId: id, name, token: await issueToken(env, id, name) };
}

// ---- Log in a returning user (global name + password) ---------------------
export async function login(env, body) {
  const pw = String((body && body.password) || '');
  if (!pw) return { ok: false, error: 'no_password' };
  const u = await getUserByName(env, String((body && body.name) || '').trim());
  if (!u) return { ok: false, error: 'no_user' };
  if (u.hash !== md5(pw)) return { ok: false, error: 'bad_password' };
  return { ok: true, userId: u.id, name: u.name, token: await issueToken(env, u.id, u.name) };
}

// ---- Resume a saved session (sliding expiry) ------------------------------
export async function resume(env, token) {
  const t = await verifyToken(env, token);
  if (!t) return { ok: false, error: 'expired' };
  const u = await getUserById(env, t.userId);
  if (!u) return { ok: false, error: 'no_user' };
  return { ok: true, userId: u.id, name: u.name, token: await issueToken(env, u.id, u.name) };
}

// ---- Change own password (verify the old one first) -----------------------
// Admin reset is a direct SQL UPDATE to a known temp hash; the user then changes
// it here with old = that temp.
export async function changePassword(env, body) {
  const t = await verifyToken(env, body && body.token);
  if (!t) return { ok: false, error: 'expired' };
  const u = await getUserById(env, t.userId);
  if (!u) return { ok: false, error: 'no_user' };
  const oldPw = String((body && body.oldPassword) || '');
  const newPw = String((body && body.newPassword) || '');
  if (!newPw) return { ok: false, error: 'no_password' };
  if (u.hash !== md5(oldPw)) return { ok: false, error: 'bad_password' };
  await setPassword(env, u.id, md5(newPw));
  return { ok: true };
}

// ---- The leagues the caller is in, for a tournament -----------------------
export async function myLeagues(env, body) {
  const t = await verifyToken(env, body && body.token);
  if (!t) return { ok: false, error: 'expired' };
  return { ok: true, leagues: await getUserLeagues(env, t.userId, (body && body.tournamentId) || '') };
}

// ---- Join a league: join code OR inheritance ------------------------------
// Allowed if the join code matches the league's password, OR the league declares
// an inheritsLeagueId and the caller already belongs to that (prior) league.
export async function joinLeague(env, body) {
  const t = await verifyToken(env, body && body.token);
  if (!t) return { ok: false, error: 'expired' };
  const tid = String((body && body.tournamentId) || '');
  const lg = await getLeague(env, tid, body && body.leagueId);
  if (!lg) return { ok: false, error: 'bad_league' };

  if (await isMember(env, t.userId, tid, lg.id)) return { ok: true, joined: lg.id, already: true };

  const code = String((body && body.joinCode) || '');
  let allowed = !!code && code === String(lg.password);
  if (!allowed && lg.inheritsLeagueId) {
    allowed = await isMember(env, t.userId, lg.inheritsTournamentId || tid, lg.inheritsLeagueId);
  }
  if (!allowed) return { ok: false, error: 'bad_join_code' };

  await addMembership(env, t.userId, tid, lg.id);
  return { ok: true, joined: lg.id };
}

// ---- Leagues the caller can join CODE-FREE via inheritance ----------------
// Leagues in the tournament they're not yet in that declare inheritsLeagueId AND
// whose inherited league they DO belong to. Powers the one-click join buttons.
export async function joinableLeagues(env, body) {
  const tk = await verifyToken(env, body && body.token);
  if (!tk) return { ok: false, error: 'expired' };
  const tid = String((body && body.tournamentId) || '');
  const out = [];
  for (const lg of await getLeaguesFull(env, tid)) {
    if (!lg.inheritsLeagueId) continue;
    if (await isMember(env, tk.userId, tid, lg.id)) continue;
    if (await isMember(env, tk.userId, lg.inheritsTournamentId || tid, lg.inheritsLeagueId)) {
      out.push({ id: lg.id, name: lg.name });
    }
  }
  return { ok: true, leagues: out };
}

// ---- Validate an invitation link (t + league + join_code) WITHOUT joining --
// Lets the frontend show an "accept invitation" banner only for a valid, joinable
// league. Optional token → also filters out leagues the caller already belongs to.
export async function checkInvite(env, body) {
  const tid = String((body && body.tournamentId) || '');
  const lg = await getLeague(env, tid, body && body.leagueId);
  if (!lg) return { ok: true, valid: false };
  if (String((body && body.joinCode) || '') !== String(lg.password)) return { ok: true, valid: false };
  const tk = body && body.token ? await verifyToken(env, body.token) : null;
  if (tk && (await isMember(env, tk.userId, tid, lg.id))) return { ok: true, valid: false, already: true };
  return { ok: true, valid: true, leagueId: lg.id, leagueName: lg.name };
}

// ---- Read the caller's (privacy-filtered) guesses for a league ------------
// Serves ONLY the live (active) matches — those not in the frozen snapshot the
// client loads separately. Privacy: the caller's OWN picks (any state) plus every
// member's picks for LOCKED games, scoped to the requested league.
export async function readGuesses(env, body) {
  const u = await resolveUser(env, body);
  if (!u) return { ok: false, error: 'unauthorized' };
  const tid = String((body && body.tournamentId) || '');
  const lid = normalize(body && body.leagueId);
  if (!lid || !(await isMember(env, u.id, tid, lid))) return { ok: false, error: 'not_member' };

  const { locked, active } = await guessScope(env, tid);

  // Active set unknown (fixtures/snapshot unreachable) → own picks only.
  if (!active) {
    const own = await getOwnGuesses(env, u.id, tid);
    return { ok: true, league: lid, guesses: own.map((g) => ({ player: u.name, ...g })) };
  }

  const lockedMap = locked || {};
  const memberIds = await getLeagueMemberIds(env, tid, lid);
  const rows = await getLeagueGuessesByMatches(env, tid, memberIds, active);
  const out = rows
    .filter((g) => g.userId === u.id || lockedMap[String(g.matchId)])
    .map(({ userId, ...rest }) => rest); // drop internal userId
  return { ok: true, league: lid, guesses: out };
}

// ---- Save picks (auth-gated, one set per tournament) ----------------------
// Picks for LOCKED games are dropped server-side (counted in `rejected`). The
// caller must belong to at least one league in the tournament.
export async function save(env, body) {
  const u = await resolveUser(env, body);
  if (!u) return { ok: false, error: 'bad_password' };
  const tid = String((body && body.tournamentId) || '');
  const leagues = await getUserLeagues(env, u.id, tid);
  if (!leagues.length) return { ok: false, error: 'not_member' };

  const guesses = body.guesses || [];
  const locked = (await lockedMatchIds(env, tid)) || {};
  const accepted = guesses.filter((g) => !locked[String(g.matchId)]);
  const rejected = guesses.length - accepted.length;

  const clean = [];
  for (const g of accepted) {
    if (g.home === '' || g.away === '' || g.home == null || g.away == null) continue;
    const pen = g.penaltyWinner === 'home' || g.penaltyWinner === 'away' ? g.penaltyWinner : '';
    clean.push({ matchId: String(g.matchId), home: Number(g.home), away: Number(g.away), pen });
  }

  await saveGuesses(env, u.id, tid, clean);
  return { ok: true, saved: clean.length, rejected };
}
