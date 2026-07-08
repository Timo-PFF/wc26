/* World Cup Prediction Pool — Cloudflare Worker backend (D1-backed).
 *
 * Drop-in replacement for the Google Apps Script backend: same request/response
 * shapes, so the static frontend is unchanged (it just points `?api=` — or, after
 * cutover, SCRIPT_URL — at this Worker's URL). Picks storage only; fixtures and
 * scoring still live in the fixtures JSON and the browser.
 *
 *   GET  ?action=leagues   -> { leagues:[{id,name}] }        (public)
 *   GET  ?league=ID        -> { players:[...] }              (public)
 *   POST { action:'auth'|'resume'|'switchLink'|'addPlayer'|'guesses', ... }
 *   POST { token|league+name+password, guesses:[...] }       (default = savePicks)
 *
 * Bindings (wrangler.toml / secrets):
 *   env.DB             — D1 database
 *   env.SESSION_SECRET — HMAC key for session tokens (secret / .dev.vars)
 *   env.FIXTURES_URL   — hosted fixtures JSON (for lock state)
 */

import { getLeagues, playersForLeague } from './db.js';
import {
  addPlayer,
  authPlayer,
  resumeSession,
  switchLink,
  getGuessesFor,
  savePicks,
} from './handlers.js';

// The frontend is served from a different origin (GitHub Pages), so every
// response is CORS-open. There are no cookies/credentials (the token travels in
// the body), so `*` is safe and avoids per-origin config.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET') {
        const action = url.searchParams.get('action') || 'config';
        if (action === 'leagues') return json({ leagues: await getLeagues(env) });
        // The (non-sensitive) joined-name list for ONE league.
        return json({ players: await playersForLeague(env, url.searchParams.get('league')) });
      }

      if (request.method === 'POST') {
        const body = JSON.parse(await request.text());
        switch (body.action) {
          case 'addPlayer': return json(await addPlayer(env, body));
          case 'auth': return json(await authPlayer(env, body));
          case 'resume': return json(await resumeSession(env, body.token));
          case 'switchLink': return json(await switchLink(env, body));
          case 'guesses': return json(await getGuessesFor(env, body));
          default: return json(await savePicks(env, body)); // no action → save picks
        }
      }

      return json({ ok: false, error: 'method_not_allowed' }, 405);
    } catch (err) {
      // Mirror the old backend: application errors come back as HTTP 200 {ok:false}.
      return json({ ok: false, error: String(err) });
    }
  },
};
