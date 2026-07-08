/* Data access — the D1 (SQLite) equivalent of the Apps Script Sheet readers.
 *
 * Tables mirror the old Sheet tabs one-to-one (see schema.sql):
 *   leagues(id, name, password)
 *   players(league, name, passHash)                       PK (league, name)
 *   guesses(league, ts, player, matchId, guessHome, guessAway, penaltyWinner)
 *                                                          PK (league, player, matchId)
 *   links(linkId, league, name)
 *
 * The tables are tiny (a few leagues, ~20 players), so leagues/players/links are
 * read whole and matched in JS with normalize() — this reproduces the old
 * Unicode-aware case-insensitive matching exactly (SQLite's COLLATE NOCASE folds
 * ASCII only). Guesses is filtered by league in SQL since it's the largest table.
 */

export function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

// --- Leagues ---------------------------------------------------------------

// Public league list — id + display name only, never the password.
export async function getLeagues(env) {
  const { results } = await env.DB.prepare('SELECT id, name FROM leagues').all();
  return results
    .filter((r) => String(r.id).trim())
    .map((r) => ({ id: String(r.id).trim(), name: String(r.name).trim() }));
}

// Full league record (incl. plaintext join password) for a given id, or null.
export async function getLeague(env, id) {
  const want = normalize(id);
  if (!want) return null;
  const { results } = await env.DB.prepare('SELECT id, name, password FROM leagues').all();
  for (const r of results) {
    if (normalize(r.id) === want) {
      return { id: String(r.id).trim(), name: String(r.name).trim(), password: String(r.password || '') };
    }
  }
  return null;
}

// --- Players ---------------------------------------------------------------

// Joined-player lookup within a league (case-insensitive). Returns
// { league, name, hash } (canonical casing from the row) or null.
export async function getPlayer(env, league, name) {
  const lg = normalize(league), n = normalize(name);
  if (!lg || !n) return null;
  const { results } = await env.DB.prepare('SELECT league, name, passHash FROM players').all();
  for (const r of results) {
    if (normalize(r.league) === lg && normalize(r.name) === n) {
      return { league: String(r.league).trim(), name: String(r.name).trim(), hash: String(r.passHash || '').trim() };
    }
  }
  return null;
}

// Joined names for one league (for the login name dropdown).
export async function playersForLeague(env, league) {
  const lg = normalize(league);
  if (!lg) return [];
  const { results } = await env.DB.prepare('SELECT league, name FROM players').all();
  return results
    .filter((r) => normalize(r.league) === lg && String(r.name).trim())
    .map((r) => String(r.name).trim());
}

// --- Links (cross-league player links) -------------------------------------

export async function getLinks(env) {
  const { results } = await env.DB.prepare('SELECT linkId, league, name FROM links').all();
  return results
    .filter((r) => String(r.linkId).trim() && String(r.name).trim())
    .map((r) => ({ linkId: String(r.linkId).trim(), league: String(r.league).trim(), name: String(r.name).trim() }));
}

// Who a pick by (league, name) should be written for: the player plus everyone
// sharing one of their linkIds — but only targets that actually exist in Players
// (typos / not-yet-joined Links rows are skipped). Returns [{ league, name }]
// with each target's canonical Players name. No links → just the player.
export async function linkGroupFor(env, league, name) {
  const out = {};
  const selfKey = normalize(league) + '|' + normalize(name);
  out[selfKey] = { league, name }; // caller (already authenticated)

  const links = await getLinks(env);
  if (!links.length) return [out[selfKey]];

  const myIds = {};
  links.forEach((r) => {
    if (normalize(r.league) + '|' + normalize(r.name) === selfKey) myIds[r.linkId] = true;
  });
  for (const r of links) {
    if (!myIds[r.linkId]) continue;
    const key = normalize(r.league) + '|' + normalize(r.name);
    if (out[key]) continue; // already added (incl. self)
    const pl = await getPlayer(env, r.league, r.name); // skip non-existent combos
    if (pl) out[key] = { league: pl.league, name: pl.name };
  }
  return Object.keys(out).map((k) => out[k]);
}

// The OTHER players linked to (league, name) — the link group minus the player.
export async function linkedOthers(env, league, name) {
  const selfKey = normalize(league) + '|' + normalize(name);
  const group = await linkGroupFor(env, league, name);
  return group.filter((t) => normalize(t.league) + '|' + normalize(t.name) !== selfKey);
}

// --- Guesses ---------------------------------------------------------------

// All picks for one league. The (league, player, matchId) primary key already
// guarantees one row per pick, so no dedup pass is needed (the old Sheet reader
// deduped defensively because the sheet could accumulate duplicate rows).
export async function getGuesses(env, league) {
  const { results } = await env.DB
    .prepare('SELECT player, matchId, guessHome, guessAway, penaltyWinner FROM guesses WHERE league = ? COLLATE NOCASE')
    .bind(String(league))
    .all();
  return results
    .filter((r) => String(r.player).trim() && String(r.matchId).trim())
    .map((r) => ({
      player: String(r.player).trim(),
      matchId: String(r.matchId).trim(),
      home: Number(r.guessHome),
      away: Number(r.guessAway),
      penaltyWinner: String(r.penaltyWinner || '').trim(), // 'home' | 'away' | ''
    }));
}
