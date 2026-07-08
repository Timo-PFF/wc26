/* Locked-match detection — ported from the Apps Script `lockedMatchIds()`.
 *
 * A game is LOCKED (its picks become public / can't be changed) once it is either
 * completed or past kickoff. Lock state is GLOBAL across leagues and comes from
 * the hosted fixtures JSON — the same file the frontend uses. We let Cloudflare's
 * edge cache hold the fetch for a short TTL instead of the old CacheService.
 */

const FIXTURES_CACHE_TTL_SECONDS = 120; // matches the old 2-minute CacheService TTL

// Normalise ESPN's "…T19:00Z" (no seconds) to something Date.parse handles.
function kickoffMs(date) {
  if (!date) return NaN;
  const iso = String(date).replace(/T(\d\d):(\d\d)Z$/, 'T$1:$2:00Z');
  return Date.parse(iso);
}

// { matchId: true } for every locked game, or null if the fixtures are unreachable
// (callers treat null as "unknown" → only the caller's own picks are revealed).
export async function lockedMatchIds(env) {
  const url = env.FIXTURES_URL;
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      cf: { cacheTtl: FIXTURES_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    const matches = (await resp.json()).matches || [];
    const now = Date.now();
    const locked = {};
    for (const m of matches) {
      const completed = m.status && m.status.completed;
      const ko = kickoffMs(m.date);
      const started = !Number.isNaN(ko) && ko <= now;
      if (completed || started) locked[String(m.id)] = true;
    }
    return locked;
  } catch (e) {
    return null;
  }
}
