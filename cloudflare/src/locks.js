/* Fixtures-derived state — ported/extended from the Apps Script `lockedMatchIds()`.
 *
 * Two things feed the guesses read path:
 *   - LOCKED matches: completed or past kickoff → picks become public / immutable.
 *   - ACTIVE matches: the still-live games. Defined as the fixture matchIds that do
 *     NOT appear in the frozen finished-guesses snapshot (SNAPSHOT_URL). Everything
 *     in the snapshot is served to the client as a static file; the API only serves
 *     the active ones. No hardcoded ids or stage logic — the snapshot is the
 *     authority, so this works unchanged for future tournaments.
 * Both are GLOBAL across leagues.
 */

const FIXTURES_CACHE_TTL_SECONDS = 120; // matches the old 2-minute CacheService TTL
const SNAPSHOT_CACHE_TTL_SECONDS = 3600; // the snapshot is immutable, cache hard

// The snapshot's matchId set is immutable, so parse it once per isolate.
let snapshotIdsMemo = null;

// Normalise ESPN's "…T19:00Z" (no seconds) to something Date.parse handles.
function kickoffMs(date) {
  if (!date) return NaN;
  const iso = String(date).replace(/T(\d\d):(\d\d)Z$/, 'T$1:$2:00Z');
  return Date.parse(iso);
}

// The fixtures match array, or null if unreachable (edge-cached).
async function fetchFixtureMatches(env) {
  const url = env.FIXTURES_URL;
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      cf: { cacheTtl: FIXTURES_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    return (await resp.json()).matches || [];
  } catch (e) {
    return null;
  }
}

// Distinct matchIds present in the finished-guesses snapshot CSV, or null if it
// can't be fetched. Columns: league,player,matchId,home,away,penaltyWinner
// (unquoted — see build_historical.mjs — so matchId is just split index 2).
async function snapshotMatchIds(env) {
  if (snapshotIdsMemo) return snapshotIdsMemo;
  const url = env.SNAPSHOT_URL;
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      cf: { cacheTtl: SNAPSHOT_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    const ids = new Set();
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i += 1) { // skip header row
      const matchId = (lines[i].split(',')[2] || '').trim();
      if (matchId) ids.add(matchId);
    }
    snapshotIdsMemo = ids; // only memoise on success
    return ids;
  } catch (e) {
    return null;
  }
}

function computeLocked(matches) {
  const now = Date.now();
  const locked = {};
  for (const m of matches) {
    const completed = m.status && m.status.completed;
    const ko = kickoffMs(m.date);
    const started = !Number.isNaN(ko) && ko <= now;
    if (completed || started) locked[String(m.id)] = true;
  }
  return locked;
}

// { matchId: true } for every locked game, or null if fixtures are unreachable
// (savePicks treats null as "can't prove locked" and lets the write through).
export async function lockedMatchIds(env) {
  const matches = await fetchFixtureMatches(env);
  return matches ? computeLocked(matches) : null;
}

// For the guesses read path: the LOCKED map plus the ACTIVE match ids (fixture
// matchIds not present in the snapshot). `active` is null if fixtures OR the
// snapshot are unreachable → the caller falls back to own-picks-only.
export async function guessScope(env) {
  const matches = await fetchFixtureMatches(env);
  if (!matches) return { locked: null, active: null };
  const locked = computeLocked(matches);
  const snapIds = await snapshotMatchIds(env);
  if (!snapIds) return { locked, active: null };
  const active = matches.map((m) => String(m.id)).filter((id) => !snapIds.has(id));
  return { locked, active };
}
