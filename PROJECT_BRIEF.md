# World Cup Prediction Pool — project brief / handoff

You're picking up a small, already-started project. Read this, then confirm the
current state by reading the files before changing anything. (You can also save
this as `CLAUDE.md` so it stays in context.)

## What it is

A lightweight World Cup score-prediction pool for family & friends. People open
a static web page, pick scorelines for each match, and submit. A leaderboard
ranks them by points. Must stay free, serverless, and low-maintenance.

## Architecture (decided, don't re-litigate unless asked)

```
data/wc2026_fixtures.json ─┐                        (games + results + odds)
                           ├─► index.html ──POST/GET picks──► Code.gs ─► Google Sheet
python/fetch_fixtures.py ──┘   (static page,                  (Apps Script  (player list
 (refreshes that JSON)          computes leaderboard)          web app)       + picks)
```

- **Static frontend** (`index.html`) hosted on GitHub Pages. No build step, single file.
- **Backend = a Google Sheet** behind a Google Apps Script web app (`server/Code.gs`).
  It stores ONLY the player list and submitted picks. No fixtures, no scoring there.
- **Fixtures + results live in a JSON file**, not the sheet. Editing JSON (or
  re-running the fetch script) is how games and final scores get updated.
- **Scoring is done in the browser**: the page loads the fixtures JSON + all
  picks and computes standings client-side.
- **Scoring rule**: exact score = 3 pts, correct outcome only = 1 pt, else 0.
  Tie-break: points, then exact hits, then name.

## Files

- `server/Code.gs` — Apps Script web app. Multi-league: every player/pick is scoped to a
  `league` (pool). `doGet?action=leagues` → `{leagues:[{id,name}]}` (public picker);
  `doGet?league=ID` → that league's `{players}`. `doPost` `auth`/`addPlayer` take a
  league (addPlayer also needs the league's join password); `guesses` + savePicks
  derive the league from the HMAC token, so a session only ever touches its own pool.
  `setupSheet()` creates the `Leagues`, `Players` and `Guesses` tabs. Deploy as web
  app, "Execute as: Me", "Who has access: Anyone".
- `index.html` — two tabs (Make picks / Standings). Reads `SCRIPT_URL` (the
  deployed /exec URL) and `FIXTURES_URL`. Locks matches that already have a final
  score. POSTs with no custom headers (text/plain) to avoid CORS preflight.
- `SETUP.md` — end-user setup guide (sheet, deploy, fixtures, GitHub Pages).
- `python/fetch_fixtures.py` — pulls the ESPN scoreboard API day-by-day
  (`20260611`–`20260719`), de-dupes by match id, writes `wc2026_fixtures.json`.
  Run: `pip install requests && python python/fetch_fixtures.py --out data/wc2026_fixtures.json`.
- `data/wc2026_fixtures.json` — generated fixtures (see schema below).

## ⚠ Known gap to fix first: two different fixtures schemas

The web app and the fetch script currently DON'T agree on the JSON shape. This
is the main thing to bring up to date.

`index.html` today expects the original hand-authored shape:
```json
{ "title": "...", "scoring": {"exact":3,"outcome":1},
  "matches": [ {"id":"M1","home":"Brazil","away":"Germany",
                "kickoff":"2026-06-12 18:00","homeGoals":null,"awayGoals":null} ] }
```

`python/fetch_fixtures.py` produces the richer ESPN shape:
```json
{ "source":"...", "generatedAt":"...", "range":{...}, "count":N,
  "matches": [ {
     "id":"760415", "date":"2026-06-11T19:00Z", "name":"...", "shortName":"...",
     "status":{"name":"STATUS_SCHEDULED","state":"pre","completed":false,"detail":"...","shortDetail":"..."},
     "venue":{"fullName":"...","city":"...","country":"..."},
     "home":{"id":"203","displayName":"Mexico","shortDisplayName":"Mexico","name":"Mexico",
             "abbreviation":"MEX","logo":"https://.../mex.png","score":null,"winner":false},
     "away":{...},
     "winner":null,                       // "home"|"away"|"draw"|null
     "odds":{"provider":"DraftKings","details":"MEX -230","overUnder":2.5,
             "moneyline":{"home":"-230","away":"+700","draw":"+340"},
             "spread":{"line":"-1.5","odds":"+125"}}
  } ] }
```

Differences that matter: `home`/`away` are objects (not strings); kickoff is
`date` (ISO UTC); scores are `home.score`/`away.score` (not `homeGoals`/`awayGoals`);
there's no `scoring` block; and there's extra data (logos, odds, venue).

**Preferred fix:** update `index.html` to consume the ESPN schema directly so it
can show team logos and (optionally) odds. Specifically:
- read team names from `home.displayName` / `away.displayName` (use
  `shortDisplayName` or `abbreviation` on narrow screens), render `home.logo`/`away.logo`;
- treat a match as finished when `status.completed === true`, using
  `home.score` / `away.score` as the result (keep current pick-locking behavior);
- keep the 3/1/0 scoring constant in `index.html` (the ESPN file has no scoring block),
  or add a small `scoring` field to the generated file if you'd rather keep it data-driven;
- point `FIXTURES_URL` at `data/wc2026_fixtures.json`.

(Alternative if you'd rather not touch the frontend much: add a transform step
to the Python that also emits a slim `home`/`away`-as-string + `homeGoals`/`awayGoals`
file in the old shape. Less nice — loses logos/odds in the UI.)

## Other things to verify / tidy

- `SCRIPT_URL` in `index.html` is still the `PASTE_…` placeholder.
- `FIXTURES_URL` in `index.html` is still `"fixtures.json"` → should be `"data/wc2026_fixtures.json"`.
- `SETUP.md` paths reference a flat layout; update for the `python/` + `data/` folders.
- Knockout matches come from ESPN with placeholder names ("Group A 2nd Place")
  until the bracket fills — re-running the fetch later replaces them with real teams.
- Local testing of `index.html` over `file://` blocks the fixtures fetch; use a
  local server (`python -m http.server`) or test on GitHub Pages.

## Constraints / non-goals

- No real auth (family/friends, unguessable URL). Picks are publicly readable.
  A shared-PIN gate is a possible future add, not built yet.
- Keep it serverless and free. Don't introduce a real database or backend server.
- Keep `index.html` a single self-contained file (inline CSS/JS).

## Suggested first tasks for you

1. Reconcile the fixtures schema (update `index.html` to read the ESPN shape;
   show logos; fix `FIXTURES_URL`).
2. Refresh `SETUP.md` for the new folder layout and the richer fixtures file.
3. (Optional) Add a `scoring` block to the generated JSON, or a small
   `--scoring` flag to the fetch script, so points stay data-driven.
4. (Optional) Add a scheduled refresh (cron/GitHub Action) that re-runs the
   fetch so results update automatically.

Please start by reading `index.html`, `server/Code.gs`, `python/fetch_fixtures.py`, and
a sample of `data/wc2026_fixtures.json`, then propose a short plan before editing.
