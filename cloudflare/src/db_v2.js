/* Data access — v2 (global-users monolith). See schema_v2.sql:
 *   users(id, name, passHash, created)                       PK id, UNIQUE name
 *   leagues(tournamentId, id, name, password,
 *           inheritsTournamentId, inheritsLeagueId)          PK (tournamentId, id)
 *   memberships(userId, tournamentId, leagueId)              PK (userId, tournamentId, leagueId)
 *   guesses(userId, tournamentId, matchId, guessHome,
 *           guessAway, penaltyWinner, ts)                    PK (userId, tournamentId, matchId)
 *
 * users / leagues / memberships are tiny → read whole and matched in JS with
 * normalize() (Unicode-aware case-insensitive, like the old backend). guesses is
 * the large table, so it's queried on its (tournamentId, matchId) / (userId,
 * tournamentId) indexes. tournament + league ids are stored normalized (lowercase)
 * by the migration, so exact-match binds keep the indexes usable.
 */

export function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

// --- Users -----------------------------------------------------------------

// Global login lookup by (case-insensitive) name → { id, name, hash } or null.
export async function getUserByName(env, name) {
  const n = normalize(name);
  if (!n) return null;
  const { results } = await env.DB.prepare('SELECT id, name, passHash FROM users').all();
  for (const r of results) {
    if (normalize(r.name) === n) {
      return { id: String(r.id), name: String(r.name).trim(), hash: String(r.passHash || '').trim() };
    }
  }
  return null;
}

export async function getUserById(env, id) {
  const { results } = await env.DB.prepare('SELECT id, name, passHash FROM users WHERE id = ?')
    .bind(String(id)).all();
  const r = results[0];
  return r ? { id: String(r.id), name: String(r.name).trim(), hash: String(r.passHash || '').trim() } : null;
}

export async function createUser(env, id, name, hash) {
  await env.DB.prepare('INSERT INTO users (id, name, passHash, created) VALUES (?, ?, ?, ?)')
    .bind(String(id), String(name), String(hash), new Date().toISOString())
    .run();
}

export async function setPassword(env, id, hash) {
  await env.DB.prepare('UPDATE users SET passHash = ? WHERE id = ?').bind(String(hash), String(id)).run();
}

// display names for a set of user ids → { id: name }
async function namesByIds(env, ids) {
  const idset = new Set(ids.map(String));
  const { results } = await env.DB.prepare('SELECT id, name FROM users').all();
  const map = {};
  for (const r of results) if (idset.has(String(r.id))) map[String(r.id)] = String(r.name).trim();
  return map;
}

// --- Leagues (per tournament) ----------------------------------------------

// Public league list for a tournament — id + display name only, no password.
export async function getLeaguesForTournament(env, tid) {
  const t = normalize(tid);
  if (!t) return [];
  const { results } = await env.DB.prepare('SELECT tournamentId, id, name FROM leagues').all();
  return results
    .filter((r) => normalize(r.tournamentId) === t && String(r.id).trim())
    .map((r) => ({ id: String(r.id).trim(), name: String(r.name).trim() }));
}

// Full league record (incl. join password + inheritance) or null.
export async function getLeague(env, tid, lid) {
  const t = normalize(tid), l = normalize(lid);
  if (!t || !l) return null;
  const { results } = await env.DB
    .prepare('SELECT tournamentId, id, name, password, inheritsTournamentId, inheritsLeagueId FROM leagues')
    .all();
  for (const r of results) {
    if (normalize(r.tournamentId) === t && normalize(r.id) === l) {
      return {
        tournamentId: String(r.tournamentId).trim(),
        id: String(r.id).trim(),
        name: String(r.name).trim(),
        password: String(r.password || ''),
        inheritsTournamentId: r.inheritsTournamentId ? String(r.inheritsTournamentId).trim() : '',
        inheritsLeagueId: r.inheritsLeagueId ? String(r.inheritsLeagueId).trim() : '',
      };
    }
  }
  return null;
}

// --- Memberships -----------------------------------------------------------

// The leagues (id + name) a user belongs to in a tournament.
export async function getUserLeagues(env, userId, tid) {
  const { results } = await env.DB
    .prepare('SELECT leagueId FROM memberships WHERE userId = ? AND tournamentId = ?')
    .bind(String(userId), normalize(tid)).all();
  const ids = new Set(results.map((r) => normalize(r.leagueId)));
  const leagues = await getLeaguesForTournament(env, tid);
  return leagues.filter((l) => ids.has(normalize(l.id)));
}

export async function isMember(env, userId, tid, lid) {
  const { results } = await env.DB
    .prepare('SELECT 1 FROM memberships WHERE userId = ? AND tournamentId = ? AND leagueId = ? LIMIT 1')
    .bind(String(userId), normalize(tid), normalize(lid)).all();
  return results.length > 0;
}

export async function addMembership(env, userId, tid, lid) {
  await env.DB
    .prepare('INSERT OR IGNORE INTO memberships (userId, tournamentId, leagueId) VALUES (?, ?, ?)')
    .bind(String(userId), normalize(tid), normalize(lid)).run();
}

export async function getLeagueMemberIds(env, tid, lid) {
  const { results } = await env.DB
    .prepare('SELECT userId FROM memberships WHERE tournamentId = ? AND leagueId = ?')
    .bind(normalize(tid), normalize(lid)).all();
  return results.map((r) => String(r.userId));
}

// Member display names for one league (public — for standings labels / display).
export async function membersForLeague(env, tid, lid) {
  const ids = await getLeagueMemberIds(env, tid, lid);
  if (!ids.length) return [];
  const names = await namesByIds(env, ids);
  return ids.map((id) => names[id]).filter(Boolean);
}

// --- Guesses ---------------------------------------------------------------

// Active-match guesses for a league's members, returned WITH display names (so the
// frontend keeps its (player, matchId, ...) shape). Queried on (tournamentId,
// matchId); `matchIds` is the small live set, `memberIds` filters in JS.
export async function getLeagueGuessesByMatches(env, tid, memberIds, matchIds) {
  if (!memberIds.length || !matchIds.length) return [];
  const names = await namesByIds(env, memberIds);
  const memberset = new Set(memberIds.map(String));
  const placeholders = matchIds.map(() => '?').join(', ');
  const { results } = await env.DB
    .prepare(`SELECT userId, matchId, guessHome, guessAway, penaltyWinner FROM guesses WHERE tournamentId = ? AND matchId IN (${placeholders})`)
    .bind(normalize(tid), ...matchIds.map(String)).all();
  return results
    .filter((r) => memberset.has(String(r.userId)) && names[String(r.userId)])
    .map((r) => ({
      userId: String(r.userId),
      player: names[String(r.userId)],
      matchId: String(r.matchId).trim(),
      home: Number(r.guessHome),
      away: Number(r.guessAway),
      penaltyWinner: String(r.penaltyWinner || '').trim(),
    }));
}

// A user's own picks in a tournament (fallback when the active set is unknown).
export async function getOwnGuesses(env, userId, tid) {
  const { results } = await env.DB
    .prepare('SELECT matchId, guessHome, guessAway, penaltyWinner FROM guesses WHERE userId = ? AND tournamentId = ?')
    .bind(String(userId), normalize(tid)).all();
  return results
    .filter((r) => String(r.matchId).trim())
    .map((r) => ({
      matchId: String(r.matchId).trim(),
      home: Number(r.guessHome),
      away: Number(r.guessAway),
      penaltyWinner: String(r.penaltyWinner || '').trim(),
    }));
}

// Upsert a user's picks (one set per tournament — no per-league mirroring). The
// (userId, tournamentId, matchId) PK makes each row an overwrite; one atomic batch.
export async function saveGuesses(env, userId, tid, clean) {
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    'INSERT OR REPLACE INTO guesses (userId, tournamentId, matchId, guessHome, guessAway, penaltyWinner, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const batch = clean.map((g) => stmt.bind(String(userId), normalize(tid), g.matchId, g.home, g.away, g.pen, now));
  if (batch.length) await env.DB.batch(batch);
}
