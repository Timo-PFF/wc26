/* Fixtures-derived state — v2 (per-tournament, manifest-resolved).
 *
 * The monolith serves many tournaments, so fixtures + snapshot are resolved PER
 * tournament from the committed manifest (data/tournaments.json): each entry's
 * files.fixtures / files.historicalGuesses are repo-relative paths, joined onto
 * env.REPO_BASE (the raw repo root). Adding a tournament = a manifest entry + a
 * data/<tid>/ folder; no Worker change.
 *
 *   - LOCKED matches: completed or past kickoff -> picks public / immutable.
 *   - ACTIVE matches: fixture matchIds NOT in the frozen snapshot -> the ONLY ones
 *     the API serves (everything in the snapshot is a static file on the client),
 *     which is what keeps D1 row-reads tiny.
 * Both are GLOBAL across a tournament's leagues.
 */

import { normalize } from './db_v2.js';

const MANIFEST_CACHE_TTL_SECONDS = 300;
const FIXTURES_CACHE_TTL_SECONDS = 120; // matches the old 2-minute TTL
const SNAPSHOT_CACHE_TTL_SECONDS = 120; // the snapshot is re-frozen periodically (live
                                        // tournaments), so don't cache it for long

let manifestMemo = null; // [{ id, files }] — immutable within an isolate
const snapshotIdsMemo = {}; // tid -> Set(matchId)

// Normalise ESPN's "…T19:00Z" (no seconds) to something Date.parse handles.
function kickoffMs(date) {
  if (!date) return NaN;
  const iso = String(date).replace(/T(\d\d):(\d\d)Z$/, 'T$1:$2:00Z');
  return Date.parse(iso);
}

async function fetchManifest(env) {
  if (manifestMemo) return manifestMemo;
  const base = env.REPO_BASE;
  if (!base) return null;
  try {
    const resp = await fetch(base + 'data/tournaments.json', {
      cf: { cacheTtl: MANIFEST_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    manifestMemo = (await resp.json()).tournaments || [];
    return manifestMemo;
  } catch (e) {
    return null;
  }
}

// { fixturesUrl, snapshotUrl } for a tournament (from the manifest), or null.
async function tournamentUrls(env, tid) {
  const base = env.REPO_BASE;
  const tournaments = await fetchManifest(env);
  if (!base || !tournaments) return null;
  const t = tournaments.find((x) => normalize(x.id) === normalize(tid));
  const files = t && t.files;
  if (!files) return null;
  return {
    fixturesUrl: files.fixtures ? base + files.fixtures : null,
    snapshotUrl: files.historicalGuesses ? base + files.historicalGuesses : null,
  };
}

// The tournament's fixtures match array, or null if unreachable (edge-cached).
async function fetchFixtureMatches(env, tid) {
  const urls = await tournamentUrls(env, tid);
  if (!urls || !urls.fixturesUrl) return null;
  try {
    const resp = await fetch(urls.fixturesUrl, {
      cf: { cacheTtl: FIXTURES_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    return (await resp.json()).matches || [];
  } catch (e) {
    return null;
  }
}

// Distinct matchIds in the tournament's finished-guesses snapshot CSV, or null if
// unreachable. Columns: player,matchId,home,away,penaltyWinner (per-player, unquoted),
// so matchId is split index 1.
async function snapshotMatchIds(env, tid) {
  const key = normalize(tid);
  if (snapshotIdsMemo[key]) return snapshotIdsMemo[key];
  const urls = await tournamentUrls(env, tid);
  if (!urls || !urls.snapshotUrl) return null;
  try {
    // ?cb= busts the edge cache once to escape a snapshot cached in the old
    // (league-based) format from before Option B; the short TTL keeps it fresh after.
    const url = urls.snapshotUrl + (urls.snapshotUrl.includes('?') ? '&' : '?') + 'cb=2';
    const resp = await fetch(url, {
      cf: { cacheTtl: SNAPSHOT_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    const ids = new Set();
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i += 1) { // skip header row
      const matchId = (lines[i].split(',')[1] || '').trim();
      if (matchId) ids.add(matchId);
    }
    snapshotIdsMemo[key] = ids; // only memoise on success
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

// { matchId: true } for every locked game in a tournament, or null if fixtures are
// unreachable (save treats null as "can't prove locked" and lets the write through).
export async function lockedMatchIds(env, tid) {
  const matches = await fetchFixtureMatches(env, tid);
  return matches ? computeLocked(matches) : null;
}

// For the read path: the LOCKED map + the ACTIVE match ids (fixture ids not in the
// snapshot). `active` is null if fixtures OR snapshot are unreachable → the caller
// falls back to own-picks-only.
export async function guessScope(env, tid) {
  const matches = await fetchFixtureMatches(env, tid);
  if (!matches) return { locked: null, active: null };
  const locked = computeLocked(matches);
  const snapIds = await snapshotMatchIds(env, tid);
  if (!snapIds) return { locked, active: null };
  const active = matches.map((m) => String(m.id)).filter((id) => !snapIds.has(id));
  return { locked, active };
}
