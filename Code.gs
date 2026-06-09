/**
 * World Cup Prediction Pool — Google Apps Script backend (picks storage only)
 * ---------------------------------------------------------------------------
 * The Sheet stores who's eligible, who has joined, and everyone's picks. It does
 * NOT hold the fixtures or do any scoring — matches, results and points live in
 * the fixtures JSON and the leaderboard is computed in the browser.
 *
 * SHEET TABS (setupSheet() creates these for you):
 *   Eligible — col A: the allowlist of names that are ALLOWED to join (header
 *              "Name" in A1). You maintain this. People can only add themselves
 *              if their name is here.
 *   Players  — col A: names that have joined; col B: MD5 hash of their password
 *              (headers "Name" / "PassHash"). Starts empty; fills as people add
 *              themselves. Feeds the picks dropdown.
 *   Guesses  — A:timestamp B:player C:matchId D:guessHome E:guessAway
 *              F:penaltyWinner ('home'/'away', only for knockout-draw picks) (auto-filled)
 *
 * Passwords are a low-friction deterrent only: MD5 (unsalted), stored in the
 * sheet, behind a public endpoint with no rate-limiting. Fine for stopping
 * casual sabotage in a family pool; not real security.
 *
 * Auth: addPlayer/auth return a session `token` (HMAC-signed, 30-day, sliding).
 * The client stores it and sends `token` on later requests instead of the
 * password (stays logged in across refreshes). token OR name+password accepted.
 *
 * API:
 *   GET  ?action=config   -> { players: [...] }                  (who has joined; public)
 *   POST { action:'auth', name, password } -> { ok, name, token } | { ok:false, error }
 *          error CODE: 'no_password' | 'not_joined' | 'bad_password'. A player
 *          with no hash yet sets their password on first auth.
 *   POST { action:'resume', token } -> { ok, name, token } | { ok:false, error }
 *          re-issues a fresh token; error CODE: 'expired' | 'not_joined'.
 *   POST { action:'guesses', token } (or name+password) -> { ok, guesses } | { ok:false, error }
 *          Auth'd + PRIVATE: returns the caller's own picks plus everyone's picks
 *          for LOCKED games only (lock state from FIXTURES_URL). No public read.
 *   POST { action:'addPlayer', name, password } -> { ok, name, token, players } | { ok:false, error }
 *          error CODE: 'empty' | 'no_password' | 'not_eligible' | 'duplicate'.
 *   POST { token (or player+password), guesses:[{matchId,home,away,penaltyWinner?}] } -> { ok, saved }
 *          | { ok:false, error:'bad_password' }
 */

// URL of the hosted fixtures JSON. The backend fetches it to learn which games
// are LOCKED (scored or kicked off), so it can keep unplayed picks private. Apps
// Script can't reach a local file or the ?fixtures= dev override, so this must be
// a publicly reachable URL. The raw GitHub URL works without GitHub Pages and
// reflects the file as soon as it's pushed (subject to ~5-min raw CDN caching).
// Left '' → no other player's picks are ever returned (maximally private, but
// Schedule/Standings then show only your own data).
// NOTE: temporarily pointed at the DEV fixtures (3 games scored) for testing the
// locked-game privacy filter — switch back to wc2026_fixtures.json for real use.
var FIXTURES_URL = 'https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2026_fixtures.dev.json';

// ---- Web app entry points -------------------------------------------------

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'config';
  // Temporary diagnostic: shows what the DEPLOYED backend sees for lock state.
  // Non-sensitive (just the fixtures URL + which match ids are locked). Remove later.
  if (action === 'debug') {
    var locked = lockedMatchIds();
    return json({
      fixturesUrl: FIXTURES_URL,
      lockedKnown: locked !== null,
      lockedCount: locked ? Object.keys(locked).length : 0,
      lockedSample: locked ? Object.keys(locked).slice(0, 5) : []
    });
  }
  // Only the (non-sensitive) player list is public. Guesses are private and
  // require auth — see the 'guesses' POST action below.
  return json({ players: readColumn('Players', 0, 1).filter(String) });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'addPlayer') return json(addPlayer(body.name, body.password));
    if (body.action === 'auth') return json(authPlayer(body.name, body.password));
    if (body.action === 'resume') return json(resumeSession(body.token));
    if (body.action === 'guesses') return json(getGuessesFor(body));
    return json(savePicks(body));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ---- Add a player (restricted self-service) -------------------------------
// Anyone may add a name, but only one that's on the Eligible list and not
// already in Players. We write the canonical Eligible spelling (never raw user
// input — also why this can't inject a sheet formula) plus the MD5 of their
// chosen password in column B.

function addPlayer(rawName, password) {
  var name = String(rawName || '').trim();
  if (!name) return { ok: false, error: 'empty' };
  if (!String(password || '')) return { ok: false, error: 'no_password' };

  var canonical = findCanonical('Eligible', name);   // must be on the guest list
  if (!canonical) return { ok: false, error: 'not_eligible' };
  if (getPlayer(canonical)) return { ok: false, error: 'duplicate' };

  var sheet = ss().getSheetByName('Players');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[canonical, md5(password)]]);
  return { ok: true, name: canonical, token: issueToken(canonical),
           players: readColumn('Players', 0, 1).filter(String) };
}

// ---- Authenticate a returning player --------------------------------------
// A player with no stored hash yet (e.g. added before passwords existed) sets
// their password on first successful login.

function authPlayer(rawName, password) {
  var pw = String(password || '');
  if (!pw) return { ok: false, error: 'no_password' };
  var p = getPlayer(String(rawName || '').trim());
  if (!p) return { ok: false, error: 'not_joined' };
  if (!p.hash) {                                     // first-time: claim the password
    ss().getSheetByName('Players').getRange(p.row, 2).setValue(md5(pw));
    return { ok: true, name: p.name, token: issueToken(p.name) };
  }
  if (p.hash !== md5(pw)) return { ok: false, error: 'bad_password' };
  return { ok: true, name: p.name, token: issueToken(p.name) };
}

// Validate a saved session token and (if good) re-issue a fresh one so active
// users stay logged in (sliding expiry).
function resumeSession(token) {
  var name = verifyToken(token);
  if (!name) return { ok: false, error: 'expired' };
  var p = getPlayer(name);
  if (!p) return { ok: false, error: 'not_joined' };
  return { ok: true, name: p.name, token: issueToken(p.name) };
}

// ---- Save picks (password-gated) ------------------------------------------

function savePicks(body) {
  var guesses = body.guesses || [];

  // Must be authenticated (session token or password). Use the canonical
  // spelling so guesses line up with the player list.
  var p = resolvePlayer(body);
  if (!p) return { ok: false, error: 'bad_password' };
  var player = p.name;

  var sheet = ss().getSheetByName('Guesses');
  var now = new Date();

  // Overwrite this player's earlier picks for the submitted matches (no dupes).
  var submittedIds = {};
  guesses.forEach(function (g) { submittedIds[String(g.matchId)] = true; });
  removePlayerGuesses(sheet, player, submittedIds);

  var rows = [];
  guesses.forEach(function (g) {
    if (g.home === '' || g.away === '' || g.home == null || g.away == null) return;
    // penaltyWinner ('home'/'away') only set when the pick is a knockout draw.
    var pen = (g.penaltyWinner === 'home' || g.penaltyWinner === 'away') ? g.penaltyWinner : '';
    rows.push([now, player, String(g.matchId), Number(g.home), Number(g.away), pen]);
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  return { ok: true, saved: rows.length };
}

// ---- Helpers --------------------------------------------------------------

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function normalize(s) { return String(s || '').trim().toLowerCase(); }

// Hex MD5 of a string (server-side, so the plaintext password is never stored).
function md5(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// Look up a joined player (case-insensitive). Returns {row, name, hash} or null.
// Players sheet: col A = canonical name, col B = MD5 password hash.
function getPlayer(name) {
  var sheet = ss().getSheetByName('Players');
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var data = sheet.getRange(2, 1, last - 1, 2).getValues();
  var n = normalize(name);
  for (var i = 0; i < data.length; i++) {
    if (normalize(data[i][0]) === n) {
      return { row: i + 2, name: String(data[i][0]).trim(), hash: String(data[i][1] || '').trim() };
    }
  }
  return null;
}

// ---- Sessions (HMAC-signed tokens — "stay logged in") ---------------------
// A token is  base64(name).expiryMs.base64(HMAC_SHA256(secret, "base64(name).expiryMs")).
// Stateless: no session table — we just re-verify the signature + expiry. The
// secret lives in Script Properties (auto-created once). Rotating it logs
// everyone out. Tokens can't be individually revoked before they expire.

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

function issueToken(name) {
  var payload = Utilities.base64Encode(name, Utilities.Charset.UTF_8) + '.' +
    (new Date().getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return payload + '.' + sign(payload);
}

// Returns the canonical name if the token's signature is valid and unexpired, else null.
function verifyToken(token) {
  if (!token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 3) return null;
  var payload = parts[0] + '.' + parts[1];
  if (sign(payload) !== parts[2]) return null;                 // tampered / wrong secret
  if (new Date().getTime() > Number(parts[1])) return null;    // expired
  try {
    return Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString('UTF-8');
  } catch (e) { return null; }
}

// Identify the requesting player from a session token (preferred) or a
// name+password pair. Returns the {row, name, hash} record or null.
function resolvePlayer(body) {
  if (body && body.token) {
    var name = verifyToken(body.token);
    return name ? getPlayer(name) : null;
  }
  var p = getPlayer(String((body && (body.player || body.name)) || '').trim());
  if (!p || !p.hash || p.hash !== md5(String((body && body.password) || ''))) return null;
  return p;
}

// Canonical spelling of `name` in a single-column tab (header in row 1),
// matched case-insensitively, or null if it isn't there.
function findCanonical(tabName, name) {
  var n = normalize(name);
  if (!n) return null;
  var values = readColumn(tabName, 0, 1).filter(String);
  for (var i = 0; i < values.length; i++) {
    if (normalize(values[i]) === n) return values[i];
  }
  return null;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readColumn(tabName, colIndex, startRow) {
  var sheet = ss().getSheetByName(tabName);
  var last = sheet.getLastRow();
  if (last < startRow + 1) return [];
  var values = sheet.getRange(startRow + 1, colIndex + 1, last - startRow, 1).getValues();
  return values.map(function (r) { return String(r[0]).trim(); });
}

function getGuesses() {
  var sheet = ss().getSheetByName('Guesses');
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var data = sheet.getRange(2, 1, last - 1, 6).getValues();
  return data.map(function (r) {
    return {
      player: String(r[1]).trim(),
      matchId: String(r[2]).trim(),
      home: Number(r[3]),
      away: Number(r[4]),
      penaltyWinner: String(r[5] || '').trim()   // 'home' | 'away' | '' (knockout draws only)
    };
  }).filter(function (g) { return g.player && g.matchId; });
}

// Authenticated, privacy-filtered guesses: the caller's OWN picks (any state)
// plus everyone's picks for games that are already LOCKED (scored / kicked off).
// Unplayed games stay private — other players' picks for them are never sent.
function getGuessesFor(body) {
  var p = resolvePlayer(body);
  if (!p) return { ok: false, error: 'unauthorized' };
  var locked = lockedMatchIds() || {};   // {} when fixtures are unknown → only own picks
  var mine = normalize(p.name);
  var out = getGuesses().filter(function (g) {
    return normalize(g.player) === mine || locked[String(g.matchId)];
  });
  return { ok: true, guesses: out };
}

// Set of locked match ids from the hosted fixtures (scored OR kicked off),
// cached briefly since the fixtures file is large. Returns null if unknown.
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
  var tok = issueToken('TestUser');
  Logger.log('token: ' + tok);
  Logger.log('verify (expect TestUser): ' + verifyToken(tok));
}

function removePlayerGuesses(sheet, player, idMap) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last - 1, 5).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var rowPlayer = String(data[i][1]).trim();
    var rowMatch = String(data[i][2]).trim();
    if (rowPlayer === player && idMap[rowMatch]) {
      sheet.deleteRow(i + 2);
    }
  }
}

// ---- One-time setup helper (run once from the editor) ---------------------

function setupSheet() {
  var book = ss();
  // Eligible = the guest list you maintain. Replace the examples with real names.
  ensureTab(book, 'Eligible', [['Name'], ['Alice'], ['Bob'], ['Charlie']]);
  // Players fills itself as people add themselves (col A name, col B password
  // hash). Starts with just the header.
  ensureTab(book, 'Players', [['Name', 'PassHash']]);
  ensureTab(book, 'Guesses', [['timestamp', 'player', 'matchId', 'guessHome', 'guessAway', 'penaltyWinner']]);
}

function ensureTab(book, name, seed) {
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0 && seed && seed.length) {
    sheet.getRange(1, 1, seed.length, seed[0].length).setValues(seed);
    sheet.getRange(1, 1, 1, seed[0].length).setFontWeight('bold');
  }
}
