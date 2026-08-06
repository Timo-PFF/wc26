/* World Cup Prediction Pool — Cloudflare Worker backend, v2 (global-users monolith).
 *
 * One Worker + one D1 serve EVERY tournament. A user is a global identity (one
 * login for all tournaments); they join per-tournament leagues; their picks are one
 * set per tournament, shared across the leagues they joined. All data-facing calls
 * carry a tournamentId (`t` for GET, `tournamentId` in the POST body).
 *
 *   GET  ?action=leagues&t=TID            -> { leagues:[{id,name}] }        (public)
 *   GET  ?action=members&t=TID&league=LID -> { members:[name,...] }        (public)
 *   POST { action:'register',  name, password }
 *   POST { action:'login',     name, password }
 *   POST { action:'resume',    token }
 *   POST { action:'changePassword', token, oldPassword, newPassword }
 *   POST { action:'myLeagues', token, tournamentId }
 *   POST { action:'joinableLeagues', token, tournamentId }        (inheritance-joinable)
 *   POST { action:'checkInvite', tournamentId, leagueId, joinCode, token? }  (validate link)
 *   POST { action:'joinLeague',token, tournamentId, leagueId, joinCode? }
 *   POST { action:'guesses',   token, tournamentId, leagueId }   (read, privacy-filtered)
 *   POST { token, tournamentId, guesses:[...] }                  (default = save picks)
 *
 * Bindings (wrangler.toml / secrets):
 *   env.DB             — D1 database (v2 schema)
 *   env.SESSION_SECRET — HMAC key for session tokens (secret / .dev.vars)
 *   env.FIXTURES_URL   — hosted fixtures JSON (lock state)
 *   env.SNAPSHOT_URL   — committed finished-guesses snapshot (active-set authority)
 */

import { getLeaguesForTournament, membersForLeague } from './db_v2.js';
import {
  register,
  login,
  resume,
  changePassword,
  myLeagues,
  joinableLeagues,
  checkInvite,
  joinLeague,
  readGuesses,
  save,
} from './handlers_v2.js';

// Frontend is a different origin (GitHub Pages); the token travels in the body
// (no cookies), so `*` is safe and avoids per-origin config.
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
        const tid = url.searchParams.get('t') || url.searchParams.get('tournamentId') || '';
        if (action === 'leagues') return json({ leagues: await getLeaguesForTournament(env, tid) });
        if (action === 'members') {
          return json({ members: await membersForLeague(env, tid, url.searchParams.get('league')) });
        }
        return json({ ok: true }); // config ping
      }

      if (request.method === 'POST') {
        const body = JSON.parse(await request.text());
        switch (body.action) {
          case 'register': return json(await register(env, body));
          case 'login':
          case 'auth': return json(await login(env, body)); // 'auth' alias for parity
          case 'resume': return json(await resume(env, body.token));
          case 'changePassword': return json(await changePassword(env, body));
          case 'myLeagues': return json(await myLeagues(env, body));
          case 'joinableLeagues': return json(await joinableLeagues(env, body));
          case 'checkInvite': return json(await checkInvite(env, body));
          case 'joinLeague': return json(await joinLeague(env, body));
          case 'guesses': return json(await readGuesses(env, body));
          default: return json(await save(env, body)); // no action → save picks
        }
      }

      return json({ ok: false, error: 'method_not_allowed' }, 405);
    } catch (err) {
      // Mirror the old backend: application errors come back as HTTP 200 {ok:false}.
      return json({ ok: false, error: String(err) });
    }
  },
};
