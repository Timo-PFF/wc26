# wc26 backend — Cloudflare Worker + D1

Drop-in replacement for the Google Apps Script backend. Same request/response
shapes, so the static frontend is unchanged — it just points at this Worker's URL
(via `?api=` while testing, then `SCRIPT_URL` at cutover).

- **Runtime:** `src/worker.js` (router) → `handlers.js` → `db.js` / `auth.js` /
  `locks.js` / `md5.js`.
- **Store:** D1 (SQLite), tables mirror the old Sheet tabs (`schema.sql`).
- **Auth:** same HMAC-SHA256 token format + legacy MD5 password hashes preserved.
- **Reads:** picks for finished matches are frozen in a committed static file
  (`data/wc2026_historical_guesses.csv`); the Worker serves only the **live**
  matches (fixture ids not in that file) and the frontend merges the two. This
  keeps the D1 read volume tiny (a handful of rows per request instead of the whole
  guesses table). The split is derived from the snapshot at runtime — no hardcoded
  ids — so it needs no maintenance and works for a future tournament unchanged.

Everything below works **locally with no Cloudflare account**; you only need the
(free) account for the deploy step at the end.

## 0. Prereqs

- Node 18+ and npm.
- `cd cloudflare && npm install` (installs `wrangler` locally).

## 1. Export the Sheet → seed the local DB

In the Google Sheet, for each tab do **File → Download → Comma Separated Values**,
and save into `cloudflare/seed/` (create the folder) with these exact names:

| Tab | File | Columns (header row kept) |
|---|---|---|
| Leagues | `seed/leagues.csv` | id, name, password |
| Players | `seed/players.csv` | league, name, passHash |
| Guesses | `seed/guesses.csv` | league, timestamp, player, matchId, guessHome, guessAway, penaltyWinner |
| Links | `seed/links.csv` | linkId, league, name *(optional)* |

Then build the SQL and load it into a **local** D1:

```bash
npm run seed:build        # seed/*.csv  ->  seed/seed.sql (dedups guesses)
npm run db:init:local     # create tables + indexes
npm run db:seed:local     # load the data
```

> `seed/*.csv` and `seed/seed.sql` are gitignored — they hold password hashes and
> league join secrets. Keep them off the public repo.

Then build the public finished-match snapshot (safe to commit — completed-game
picks are already visible to pool members):

```bash
npm run historical:build  # fixtures + seed/guesses.csv -> data/wc2026_historical_guesses.csv
```

Commit that CSV; the Worker (and frontend) read it from the repo's raw URL. Re-run
it only if you want to freeze more matches at a later point.

## 2. Local dev server

```bash
cp .dev.vars.example .dev.vars     # set SESSION_SECRET (any string for dev)
npm run dev                        # wrangler dev → http://localhost:8787
```

`.dev.vars` also sets `SNAPSHOT_URL`. Note: `wrangler dev`'s runtime **can't reach
your loopback** static server (`fetch` to `127.0.0.1` fails with "Network
connection lost"), so point it at the committed **raw GitHub URL** instead — the
Worker reaches the public internet fine (same as it fetches fixtures):

```
SNAPSHOT_URL=https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2026_historical_guesses.csv
```

Smoke test:

```bash
curl "http://localhost:8787/?action=leagues"
curl "http://localhost:8787/?league=family"
```

## 3. Test the real frontend against local D1

Open the site with an `?api=` override pointing at the local Worker — no file edit,
no impact on the live Apps Script backend:

```
index.html?api=http://localhost:8787
```

Log in, make picks, check standings — all reads/writes now hit local D1.

## 4. Deploy (needs a free Cloudflare account)

```bash
npx wrangler login
npx wrangler d1 create wc26          # first time only; paste database_id into wrangler.toml
npm run db:init:remote               # create/refresh tables + indexes (idempotent)
npm run db:seed:remote               # first time only; re-export CSVs + npm run seed:build first
npx wrangler secret put SESSION_SECRET
npm run deploy                       # prints the Worker URL
```

Cutover / updates ordering (important):

1. **Commit + push** the frontend, `cloudflare/` code, and the snapshot CSV. Pages
   serves the new frontend; the still-deployed old Worker keeps working (the new
   frontend merges + dedups, so standings stay correct).
2. **`npm run deploy`** the Worker — **only after** the frontend is pushed. The
   reverse (new Worker + old frontend) breaks standings, because the old frontend
   doesn't load the snapshot and would see only the live matches from the API.

`SCRIPT_URL` in `index.html` already points at the Worker; the prod `SNAPSHOT_URL`
in `wrangler.toml` already points at the committed CSV.

### Notes

- To keep existing logins valid after cutover, set `SESSION_SECRET` to the old
  Apps Script value (editor → Project Settings → Script Properties). Otherwise
  everyone just logs in once.
- `FIXTURES_URL` (in `wrangler.toml`) is used for locked-game state and the full
  fixture id list; `SNAPSHOT_URL` points at the committed finished-guesses CSV.
  Together they define the live set (`fixtures − snapshot`). If either is
  unreachable the Worker falls back to serving the caller's own picks only.
- Admin edits (add a league, link two players) are now SQL, e.g.:
  `npx wrangler d1 execute wc26 --remote --command "INSERT INTO leagues VALUES ('friends','Friends','joinpw');"`
