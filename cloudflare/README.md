# wc26 backend — Cloudflare Worker + D1

Drop-in replacement for the Google Apps Script backend. Same request/response
shapes, so the static frontend is unchanged — it just points at this Worker's URL
(via `?api=` while testing, then `SCRIPT_URL` at cutover).

- **Runtime:** `src/worker.js` (router) → `handlers.js` → `db.js` / `auth.js` /
  `locks.js` / `md5.js`.
- **Store:** D1 (SQLite), tables mirror the old Sheet tabs (`schema.sql`).
- **Auth:** same HMAC-SHA256 token format + legacy MD5 password hashes preserved.
- **Reads:** picks for finished matches are frozen in a committed static file
  (`data/wc2026/wc2026_historical_guesses.csv`); the Worker serves only the **live**
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

The public finished-match snapshot (safe to commit — completed-game picks are
already visible to pool members) is built under v2 by `python/migrate_v2.py`, which
writes the per-player `data/<tid>/<tid>_historical_guesses.csv` (columns
`player,matchId,home,away,penaltyWinner`, no league column).

Commit that CSV; the Worker (and frontend) read it from the repo's raw URL. Re-run
the migration only if you want to freeze more matches at a later point.

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
SNAPSHOT_URL=https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2026/wc2026_historical_guesses.csv
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

## Reusing this backend for a future tournament

The Worker **code** (`src/`, `schema.sql`, `import/`) is tournament-agnostic — only
config + data change. Stand up a new tournament as an **isolated instance** (its own
D1 + Worker + `SCRIPT_URL`) via a wrangler *environment*, no code touched. `wc2026`
stays the top-level default, so its `npm run *` scripts keep working unchanged.

1. **New D1:** `npx wrangler d1 create wc2028` — note the printed `database_id`.
2. **Add an env to `wrangler.toml`:**
   ```toml
   [env.wc2028]
   name = "wc2028-api"                        # unique worker name → its own URL

   [env.wc2028.vars]
   FIXTURES_URL = "https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2028/wc2028_fixtures.json"
   SNAPSHOT_URL = "https://raw.githubusercontent.com/Timo-PFF/wc26/main/data/wc2028/wc2028_historical_guesses.csv"

   [[env.wc2028.d1_databases]]
   binding = "DB"
   database_name = "wc2028"
   database_id = "<the id from step 1>"
   ```
3. **Secret + schema + seed** (target the env / new DB explicitly):
   ```bash
   npx wrangler secret put SESSION_SECRET --env wc2028
   npx wrangler d1 execute wc2028 --remote --file=schema.sql
   # export the new pool's Sheet → seed/ → build seed.sql, then:
   npx wrangler d1 execute wc2028 --remote --file=seed/seed.sql
   ```
4. **Deploy:** `npx wrangler deploy --env wc2028` → prints the new Worker URL.
5. **Frontend:** add an entry to `data/tournaments.json` (`id`, `name`, `api` = the
   new URL, `files` under `data/wc2028/…`) and set `"default": "wc2028"`. No frontend
   code change — that's the whole point of the manifest.

Caveat: under v2 the seed + finished-guesses snapshot are (re)built by
`python/migrate_v2.py`, not the old `import/` tooling. The remaining `csv_to_sql.mjs`
still hardcodes `seed/` paths — repoint it (or, better, extend `migrate_v2.py`) when
you spin up the next tournament.

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
