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
 *   Guesses  — A:timestamp B:player C:matchId D:guessHome E:guessAway (auto-filled)
 *
 * Passwords are a low-friction deterrent only: MD5 (unsalted), stored in the
 * sheet, behind a public endpoint with no rate-limiting. Fine for stopping
 * casual sabotage in a family pool; not real security.
 *
 * API:
 *   GET  ?action=config   -> { players: [...] }                  (who has joined; public)
 *   POST { action:'guesses', name, password } -> { ok, guesses } | { ok:false, error }
 *          Auth'd + PRIVATE: returns the caller's own picks plus everyone's picks
 *          for LOCKED games only (lock state from FIXTURES_URL). No public read.
 *   POST { action:'addPlayer', name, password } -> { ok, name, players } | { ok:false, error }
 *          error CODE: 'empty' | 'no_password' | 'not_eligible' | 'duplicate'.
 *   POST { action:'auth', name, password } -> { ok, name } | { ok:false, error }
 *          error CODE: 'no_password' | 'not_joined' | 'bad_password'. A player
 *          with no hash yet sets their password on first auth.
 *   POST { player, password, guesses:[{matchId,home,away}] } -> { ok, saved }
 *          | { ok:false, error:'not_joined'|'bad_password' }
 */

// URL of the hosted fixtures JSON, e.g.
//   https://USER.github.io/REPO/data/wc2026_fixtures.json
// The backend fetches it to learn which games are LOCKED (scored or kicked off),
// so it can keep unplayed picks private. Apps Script can't reach a local file or
// the ?fixtures= dev override, so this must be a publicly reachable URL.
// Left '' → no other player's picks are ever returned (maximally private, but
// Schedule/Standings then show only your own data).
var FIXTURES_URL = '';

// ---- Web app entry points -------------------------------------------------

function doGet(e) {
  // Only the (non-sensitive) player list is public. Guesses are private and
  // require auth — see the 'guesses' POST action below.
  return json({ players: readColumn('Players', 0, 1).filter(String) });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'addPlayer') return json(addPlayer(body.name, body.password));
    if (body.action === 'auth') return json(authPlayer(body.name, body.password));
    if (body.action === 'guesses') return json(getGuessesFor(body.name, body.password));
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
  return { ok: true, name: canonical, players: readColumn('Players', 0, 1).filter(String) };
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
    return { ok: true, name: p.name };
  }
  if (p.hash !== md5(pw)) return { ok: false, error: 'bad_password' };
  return { ok: true, name: p.name };
}

// ---- Save picks (password-gated) ------------------------------------------

function savePicks(body) {
  var guesses = body.guesses || [];

  // Must be a joined player AND present the matching password. Use the
  // canonical spelling so guesses line up with the player list.
  var p = getPlayer(String(body.player || '').trim());
  if (!p) return { ok: false, error: 'not_joined' };
  if (!p.hash || p.hash !== md5(String(body.password || ''))) return { ok: false, error: 'bad_password' };
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
    rows.push([now, player, String(g.matchId), Number(g.home), Number(g.away)]);
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
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
  var data = sheet.getRange(2, 1, last - 1, 5).getValues();
  return data.map(function (r) {
    return {
      player: String(r[1]).trim(),
      matchId: String(r[2]).trim(),
      home: Number(r[3]),
      away: Number(r[4])
    };
  }).filter(function (g) { return g.player && g.matchId; });
}

// Authenticated, privacy-filtered guesses: the caller's OWN picks (any state)
// plus everyone's picks for games that are already LOCKED (scored / kicked off).
// Unplayed games stay private — other players' picks for them are never sent.
function getGuessesFor(rawName, password) {
  var p = getPlayer(String(rawName || '').trim());
  if (!p || !p.hash || p.hash !== md5(String(password || ''))) return { ok: false, error: 'bad_password' };
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
  ensureTab(book, 'Guesses', [['timestamp', 'player', 'matchId', 'guessHome', 'guessAway']]);
}

function ensureTab(book, name, seed) {
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0 && seed && seed.length) {
    sheet.getRange(1, 1, seed.length, seed[0].length).setValues(seed);
    sheet.getRange(1, 1, 1, seed[0].length).setFontWeight('bold');
  }
}
