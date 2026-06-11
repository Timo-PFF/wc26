/**
 * World Cup Prediction Pool — Google Apps Script backend (picks storage only)
 * ---------------------------------------------------------------------------
 * The Sheet stores the leagues (pools), who has joined each one, and everyone's
 * picks. It does NOT hold fixtures or do scoring — matches, results and points
 * live in the fixtures JSON and the leaderboard is computed in the browser.
 *
 * MULTI-LEAGUE: every pool is an independent "league". Players, names and picks
 * are scoped to a league — the same name in two leagues is two unrelated people.
 * A league has a plaintext join password (only you, the organizer, can see the
 * Sheet and you choose the passwords, so plaintext is fine). That password is
 * needed only to CREATE an account; afterwards you log in with league + name +
 * your own personal password.
 *
 * SHEET TABS (setupSheet() creates these for a fresh install):
 *   Leagues — A:id  B:name  C:password   (you maintain this; password is the
 *             shared join secret for that pool, plaintext)
 *   Players — A:league  B:name  C:passHash  (MD5 of the personal password;
 *             fills as people create accounts; feeds the per-league name list)
 *   Guesses — A:league B:timestamp C:player D:matchId E:guessHome F:guessAway
 *             G:penaltyWinner ('home'/'away', knockout-draw picks only)
 *   Links   — A:linkId B:league C:name (optional). Rows sharing a linkId are the
 *             same person across leagues; a pick by any of them is mirrored to the
 *             others (see savePicks). You maintain it; typo/not-joined rows are skipped.
 *
 * Personal passwords are a low-friction deterrent only: MD5 (unsalted), behind a
 * public endpoint with no rate-limiting. Fine for a family pool, not real security.
 *
 * Auth: addPlayer/auth return a session `token` (HMAC-signed, 30-day, sliding)
 * that binds to (league, name). The client stores one token PER league and sends
 * it on later requests instead of the password. token OR league+name+password.
 *
 * API:
 *   GET  ?action=leagues            -> { leagues:[{id,name}] }      (public; no passwords)
 *   GET  ?league=ID                 -> { players:[...] }            (that league's joined names; public)
 *   POST { action:'auth', league, name, password } -> { ok, league, name, token, links } | { ok:false, error }
 *          error: 'bad_league' | 'no_password' | 'not_joined' | 'bad_password'
 *          `links`: [{league,name}] of any other players this account is linked to.
 *   POST { action:'resume', token } -> { ok, league, name, token, links } | { ok:false, error:'expired'|'not_joined' }
 *   POST { action:'switchLink', token, league, name } -> { ok, league, name, token, links } | { ok:false, error }
 *          Switch to a LINKED account (same link group) without its password.
 *          error: 'expired' | 'bad_league' | 'not_linked' | 'not_joined'
 *   POST { action:'guesses', token } (or league+name+password) -> { ok, guesses } | { ok:false, error }
 *          Auth'd + PRIVATE: caller's own picks plus everyone's picks for LOCKED
 *          games only, scoped to the caller's league.
 *   POST { action:'addPlayer', league, name, password, leaguePassword }
 *          -> { ok, league, name, token, players, links } | { ok:false, error }
 *          error: 'bad_league' | 'empty' | 'no_password' | 'bad_league_password' | 'duplicate'
 *   POST { token (or league+name+password), guesses:[{matchId,home,away,penaltyWinner?}] }
 *          -> { ok, saved, rejected, linked } | { ok:false, error:'bad_password' }
 *          Picks for LOCKED games (scored / kicked off) are dropped server-side
 *          (counted in `rejected`); existing picks for them are left untouched.
 *          Saved for the caller AND any linked players (Links tab); `linked` = #others.
 */

// URL of the hosted fixtures JSON. The backend fetches it to learn which games
// are LOCKED (scored or kicked off), so it can keep unplayed picks private. Apps
// Script can't reach a local file or the ?fixtures= dev override, so this must be
// a publicly reachable URL. Lock state is GLOBAL (shared by every league).
var FIXTURES_URL = 'https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2026_fixtures.json';

// ---- Web app entry points -------------------------------------------------

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action || 'config';
  // The public league list (id + display name only) populates the login picker.
  if (action === 'leagues') {
    return json({ leagues: getLeagues() });
  }
  // Temporary diagnostic: what the DEPLOYED backend sees for lock state (global).
  if (action === 'debug') {
    var locked = lockedMatchIds();
    return json({
      fixturesUrl: FIXTURES_URL,
      lockedKnown: locked !== null,
      lockedCount: locked ? Object.keys(locked).length : 0,
      lockedSample: locked ? Object.keys(locked).slice(0, 5) : []
    });
  }
  // The (non-sensitive) joined-name list for ONE league. Guesses are private and
  // require auth — see the 'guesses' POST action below.
  return json({ players: playersForLeague(params.league) });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'addPlayer') return json(addPlayer(body));
    if (body.action === 'auth') return json(authPlayer(body));
    if (body.action === 'resume') return json(resumeSession(body.token));
    if (body.action === 'switchLink') return json(switchLink(body));
    if (body.action === 'guesses') return json(getGuessesFor(body));
    return json(savePicks(body));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ---- Create an account (league-password gated) ----------------------------
// Anyone who knows a league's join password may create an account in that league
// under any (not-yet-taken) name. We store the name as typed (trimmed) plus the
// MD5 of their chosen personal password.

function addPlayer(body) {
  var lg = getLeague(body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  var name = String((body && body.name) || '').trim();
  if (!name) return { ok: false, error: 'empty' };
  if (!String((body && body.password) || '')) return { ok: false, error: 'no_password' };
  if (String((body && body.leaguePassword) || '') !== String(lg.password)) {
    return { ok: false, error: 'bad_league_password' };
  }
  if (getPlayer(lg.id, name)) return { ok: false, error: 'duplicate' };

  var sheet = ss().getSheetByName('Players');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues([[lg.id, name, md5(body.password)]]);
  return { ok: true, league: lg.id, name: name, token: issueToken(lg.id, name),
           players: playersForLeague(lg.id), links: linkedOthers(lg.id, name) };
}

// ---- Authenticate a returning player --------------------------------------

function authPlayer(body) {
  var lg = getLeague(body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  var pw = String((body && body.password) || '');
  if (!pw) return { ok: false, error: 'no_password' };
  var p = getPlayer(lg.id, String((body && body.name) || '').trim());
  if (!p) return { ok: false, error: 'not_joined' };
  if (p.hash !== md5(pw)) return { ok: false, error: 'bad_password' };
  return { ok: true, league: lg.id, name: p.name, token: issueToken(lg.id, p.name),
           links: linkedOthers(lg.id, p.name) };
}

// Validate a saved session token and (if good) re-issue a fresh one so active
// users stay logged in (sliding expiry).
function resumeSession(token) {
  var t = verifyToken(token);
  if (!t) return { ok: false, error: 'expired' };
  var p = getPlayer(t.league, t.name);
  if (!p) return { ok: false, error: 'not_joined' };
  return { ok: true, league: t.league, name: p.name, token: issueToken(t.league, p.name),
           links: linkedOthers(t.league, p.name) };
}

// Switch to a LINKED account without its password. A valid token authenticates
// the caller; the target must be in the caller's link group (which the organizer
// declared the same person — their picks already mirror), so no password is
// needed. Mints a fresh token for the target league/name.
function switchLink(body) {
  var t = verifyToken(body && body.token);
  if (!t) return { ok: false, error: 'expired' };
  var lg = getLeague(body && body.league);
  if (!lg) return { ok: false, error: 'bad_league' };
  var name = String((body && body.name) || '').trim();
  var inGroup = linkGroupFor(t.league, t.name).some(function (x) {
    return normalize(x.league) === normalize(lg.id) && normalize(x.name) === normalize(name);
  });
  if (!inGroup) return { ok: false, error: 'not_linked' };
  var p = getPlayer(lg.id, name);
  if (!p) return { ok: false, error: 'not_joined' };
  return { ok: true, league: lg.id, name: p.name, token: issueToken(lg.id, p.name),
           links: linkedOthers(lg.id, p.name) };
}

// ---- Save picks (auth-gated, league-scoped) -------------------------------

function savePicks(body) {
  var guesses = body.guesses || [];

  // Must be authenticated. The league comes from the resolved identity (token or
  // password), never from a client-supplied field — so a token can only ever
  // write into its own league.
  var p = resolvePlayer(body);
  if (!p) return { ok: false, error: 'bad_password' };

  // Never accept — or even overwrite — a pick for a game that's already LOCKED
  // (scored or kicked off). The client disables those inputs, but a crafted
  // request must be blocked here too, or someone could change a pick after
  // kickoff. Lock state is global (same source the privacy filter uses).
  // If the fixtures fetch is unavailable (locked === null), we can't prove a game
  // is locked, so we let the write through rather than block all submissions
  // during an outage; switch `|| {}` to a hard reject if you prefer strict.
  var locked = lockedMatchIds() || {};
  var accepted = guesses.filter(function (g) { return !locked[String(g.matchId)]; });
  var rejected = guesses.length - accepted.length;

  // Validate/normalise once, then reuse for the player AND any linked players.
  var clean = [];
  accepted.forEach(function (g) {
    if (g.home === '' || g.away === '' || g.home == null || g.away == null) return;
    // penaltyWinner ('home'/'away') only set when the pick is a knockout draw.
    var pen = (g.penaltyWinner === 'home' || g.penaltyWinner === 'away') ? g.penaltyWinner : '';
    clean.push({ matchId: String(g.matchId), home: Number(g.home), away: Number(g.away), pen: pen });
  });
  var submittedIds = {};
  clean.forEach(function (g) { submittedIds[g.matchId] = true; });

  var sheet = ss().getSheetByName('Guesses');
  var now = new Date();

  // Save for the player AND any LINKED players (same linkId in the Links tab),
  // each in their own league — so someone playing in several pools guesses once.
  // Each target's earlier picks for the submitted (accepted, unlocked) matches
  // are overwritten; locked games are never touched. Lock state is global, so the
  // same accepted set applies to everyone.
  var targets = linkGroupFor(p.league, p.name);
  var rows = [];
  targets.forEach(function (target) {
    removePlayerGuesses(sheet, target.league, target.name, submittedIds);
    clean.forEach(function (g) {
      rows.push([target.league, now, target.name, g.matchId, g.home, g.away, g.pen]);
    });
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  }
  // `saved` is the caller's own pick count; `linked` = how many other players also got them.
  return { ok: true, saved: clean.length, rejected: rejected, linked: targets.length - 1 };
}

// ---- Leagues --------------------------------------------------------------

// Public league list — id + display name only, never the password.
function getLeagues() {
  var sheet = ss().getSheetByName('Leagues');
  var last = sheet ? sheet.getLastRow() : 0;
  if (last < 2) return [];
  var data = sheet.getRange(2, 1, last - 1, 2).getValues();
  return data
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { id: String(r[0]).trim(), name: String(r[1]).trim() }; });
}

// Full league record (incl. plaintext password) for a given id, or null.
function getLeague(id) {
  var sheet = ss().getSheetByName('Leagues');
  var last = sheet ? sheet.getLastRow() : 0;
  if (last < 2) return null;
  var want = normalize(id);
  if (!want) return null;
  var data = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < data.length; i++) {
    if (normalize(data[i][0]) === want) {
      return { id: String(data[i][0]).trim(), name: String(data[i][1]).trim(),
               password: String(data[i][2] || '') };
    }
  }
  return null;
}

// ---- Links (cross-league player links) ------------------------------------
// The Links tab (linkId | league | name) ties one person's accounts across
// leagues. A pick saved by any linked player is mirrored to the others.

function getLinks() {
  var sheet = ss().getSheetByName('Links');
  var last = sheet ? sheet.getLastRow() : 0;
  if (last < 2) return [];
  var data = sheet.getRange(2, 1, last - 1, 3).getValues();
  return data
    .filter(function (r) { return String(r[0]).trim() && String(r[2]).trim(); })
    .map(function (r) {
      return { linkId: String(r[0]).trim(), league: String(r[1]).trim(), name: String(r[2]).trim() };
    });
}

// Who a pick by (league, name) should be written for: the player themselves plus
// everyone sharing one of their linkIds — but ONLY targets that actually exist in
// Players (typos / not-yet-joined entries in the Links tab are skipped). Returns
// [{league, name}] with each target's canonical Players-tab name. With no Links
// tab or no match, it's just the player → identical to the unlinked behaviour.
function linkGroupFor(league, name) {
  var out = {};
  var selfKey = normalize(league) + '|' + normalize(name);
  out[selfKey] = { league: league, name: name };   // caller (already authenticated)

  var links = getLinks();
  if (!links.length) return [out[selfKey]];

  var myIds = {};
  links.forEach(function (r) {
    if (normalize(r.league) + '|' + normalize(r.name) === selfKey) myIds[r.linkId] = true;
  });
  links.forEach(function (r) {
    if (!myIds[r.linkId]) return;
    var key = normalize(r.league) + '|' + normalize(r.name);
    if (out[key]) return;                       // already added (incl. self)
    var pl = getPlayer(r.league, r.name);       // skip non-existent combos (typos / not joined)
    if (pl) out[key] = { league: pl.league, name: pl.name };
  });
  return Object.keys(out).map(function (k) { return out[k]; });
}

// The OTHER players linked to (league, name) — the link group minus the player
// themselves. Used to tell a logged-in player who their picks also save for.
function linkedOthers(league, name) {
  var selfKey = normalize(league) + '|' + normalize(name);
  return linkGroupFor(league, name).filter(function (t) {
    return normalize(t.league) + '|' + normalize(t.name) !== selfKey;
  });
}

// ---- Helpers --------------------------------------------------------------

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function normalize(s) { return String(s || '').trim().toLowerCase(); }

// Hex MD5 of a string (server-side, so the plaintext password is never stored).
function md5(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// Joined-player lookup within a league (case-insensitive name).
// Players sheet: A = league, B = name, C = MD5 password hash.
// Returns {row, league, name, hash} or null.
function getPlayer(league, name) {
  var sheet = ss().getSheetByName('Players');
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var data = sheet.getRange(2, 1, last - 1, 3).getValues();
  var lg = normalize(league), n = normalize(name);
  if (!lg || !n) return null;
  for (var i = 0; i < data.length; i++) {
    if (normalize(data[i][0]) === lg && normalize(data[i][1]) === n) {
      return { row: i + 2, league: String(data[i][0]).trim(),
               name: String(data[i][1]).trim(), hash: String(data[i][2] || '').trim() };
    }
  }
  return null;
}

// Joined names for one league (for the login name dropdown).
function playersForLeague(league) {
  var sheet = ss().getSheetByName('Players');
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var data = sheet.getRange(2, 1, last - 1, 2).getValues();
  var lg = normalize(league);
  if (!lg) return [];
  return data
    .filter(function (r) { return normalize(r[0]) === lg && String(r[1]).trim(); })
    .map(function (r) { return String(r[1]).trim(); });
}

// ---- Sessions (HMAC-signed tokens — "stay logged in") ---------------------
// A token is  base64(JSON{l,n}).expiryMs.base64(HMAC_SHA256(secret, payload)).
// It binds to (league, name). Stateless: we just re-verify the signature +
// expiry. The secret lives in Script Properties (auto-created once). Rotating it
// logs everyone out. Tokens can't be individually revoked before they expire.

var SESSION_DAYS = 30;

function sessionSecret() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', s); }
  return s;
}

function sign(payload) {
  return Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(payload, sessionSecret(), Utilities.Charset.UTF_8));
}

function issueToken(league, name) {
  var data = Utilities.base64Encode(JSON.stringify({ l: league, n: name }), Utilities.Charset.UTF_8);
  var payload = data + '.' + (new Date().getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return payload + '.' + sign(payload);
}

// Returns {league, name} if the token's signature is valid and unexpired, else null.
function verifyToken(token) {
  if (!token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 3) return null;
  var payload = parts[0] + '.' + parts[1];
  if (sign(payload) !== parts[2]) return null;                 // tampered / wrong secret
  if (new Date().getTime() > Number(parts[1])) return null;    // expired
  try {
    var obj = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString('UTF-8'));
    if (!obj || !obj.l || !obj.n) return null;
    return { league: String(obj.l), name: String(obj.n) };
  } catch (e) { return null; }
}

// Identify the requesting player from a session token (preferred) or a
// league+name+password triple. Returns the {row, league, name, hash} record or null.
function resolvePlayer(body) {
  if (body && body.token) {
    var t = verifyToken(body.token);
    return t ? getPlayer(t.league, t.name) : null;
  }
  var lg = getLeague(body && body.league);
  if (!lg) return null;
  var p = getPlayer(lg.id, String((body && (body.player || body.name)) || '').trim());
  if (!p || !p.hash || p.hash !== md5(String((body && body.password) || ''))) return null;
  return p;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// All picks for one league.
function getGuesses(league) {
  var sheet = ss().getSheetByName('Guesses');
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var data = sheet.getRange(2, 1, last - 1, 7).getValues();
  var lg = normalize(league);
  return data
    .filter(function (r) { return normalize(r[0]) === lg; })
    .map(function (r) {
      return {
        player: String(r[2]).trim(),
        matchId: String(r[3]).trim(),
        home: Number(r[4]),
        away: Number(r[5]),
        penaltyWinner: String(r[6] || '').trim()   // 'home' | 'away' | '' (knockout draws only)
      };
    })
    .filter(function (g) { return g.player && g.matchId; });
}

// Authenticated, privacy-filtered guesses for the caller's league: the caller's
// OWN picks (any state) plus everyone's picks for games already LOCKED (scored /
// kicked off). Unplayed games stay private; other leagues are never visible.
function getGuessesFor(body) {
  var p = resolvePlayer(body);
  if (!p) return { ok: false, error: 'unauthorized' };
  var locked = lockedMatchIds() || {};   // {} when fixtures are unknown → only own picks
  var mine = normalize(p.name);
  var out = getGuesses(p.league).filter(function (g) {
    return normalize(g.player) === mine || locked[String(g.matchId)];
  });
  return { ok: true, league: p.league, guesses: out };
}

// Set of locked match ids from the hosted fixtures (scored OR kicked off; GLOBAL
// across leagues), cached briefly since the fixtures file is large. Null if unknown.
function lockedMatchIds() {
  if (!FIXTURES_URL) return null;
  var cache = CacheService.getScriptCache();
  var cached = cache.get('lockedIds');
  if (cached !== null) return listToSet(cached ? cached.split(',') : []);
  try {
    var resp = UrlFetchApp.fetch(FIXTURES_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var matches = (JSON.parse(resp.getContentText()).matches) || [];
    var now = new Date().getTime();
    var ids = [];
    matches.forEach(function (m) {
      var completed = m.status && m.status.completed;
      var ko = m.date ? Date.parse(String(m.date).replace(/T(\d\d):(\d\d)Z$/, 'T$1:$2:00Z')) : NaN;
      var started = !isNaN(ko) && ko <= now;
      if (completed || started) ids.push(String(m.id));
    });
    cache.put('lockedIds', ids.join(','), 120);   // 2 min
    return listToSet(ids);
  } catch (e) {
    return null;
  }
}

function listToSet(arr) { var s = {}; arr.forEach(function (x) { s[x] = true; }); return s; }

// One-off: run this from the editor to (re)authorize external requests and
// confirm the fixtures fetch works. After running, open Execution log — you want
// "HTTP 200" and a non-zero locked count.
function testFetch() {
  CacheService.getScriptCache().remove('lockedIds');   // bust the cache so we recompute
  var resp = UrlFetchApp.fetch(FIXTURES_URL, { muteHttpExceptions: true });
  Logger.log('HTTP ' + resp.getResponseCode() + ', ' + resp.getContentText().length + ' chars');
  var locked = lockedMatchIds();
  Logger.log('lockedKnown=' + (locked !== null) + ' count=' + (locked ? Object.keys(locked).length : 0));
}

// One-off: run from the editor to authorize Script Properties (the session
// secret store) and confirm token issue/verify works. Check the Execution log.
function testToken() {
  var tok = issueToken('family', 'TestUser');
  Logger.log('token: ' + tok);
  Logger.log('verify (expect {league:family,name:TestUser}): ' + JSON.stringify(verifyToken(tok)));
}

// Delete this player's earlier picks (in this league) for the given match ids.
// Guesses: A league, B timestamp, C player, D matchId.
function removePlayerGuesses(sheet, league, player, idMap) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last - 1, 4).getValues();
  var lg = normalize(league), pl = normalize(player);
  for (var i = data.length - 1; i >= 0; i--) {
    if (normalize(data[i][0]) === lg && normalize(data[i][2]) === pl && idMap[String(data[i][3]).trim()]) {
      sheet.deleteRow(i + 2);
    }
  }
}

// ---- One-time setup helper (run once from the editor) ---------------------
// For a FRESH install. On an existing single-pool sheet, migrate by hand instead:
// add a Leagues tab, prepend a `league` column to Players/Guesses, stamp existing
// rows with the league id, and delete the old Eligible tab.

function setupSheet() {
  var book = ss();
  // Leagues you maintain. Replace the example password before sharing the pool.
  ensureTab(book, 'Leagues', [['id', 'name', 'password'], ['family', 'Family', 'CHANGE_ME']]);
  // Players / Guesses fill themselves as people join and pick.
  ensureTab(book, 'Players', [['league', 'name', 'passHash']]);
  ensureTab(book, 'Guesses',
    [['league', 'timestamp', 'player', 'matchId', 'guessHome', 'guessAway', 'penaltyWinner']]);
  // Links (optional): rows sharing a linkId tie one person's accounts across
  // leagues, so a pick by any of them is mirrored to the others. You maintain it.
  ensureTab(book, 'Links', [['linkId', 'league', 'name']]);
}

function ensureTab(book, name, seed) {
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0 && seed && seed.length) {
    sheet.getRange(1, 1, seed.length, seed[0].length).setValues(seed);
    sheet.getRange(1, 1, 1, seed[0].length).setFontWeight('bold');
  }
}
