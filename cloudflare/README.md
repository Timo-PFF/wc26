# wc26 backend — Cloudflare Worker + D1

Drop-in replacement for the Google Apps Script backend. Same request/response
shapes, so the static frontend is unchanged — it just points at this Worker's URL
(via `?api=` while testing, then `SCRIPT_URL` at cutover).

- **Runtime:** `src/worker.js` (router) → `handlers.js` → `db.js` / `auth.js` /
  `locks.js` / `md5.js`.
- **Store:** D1 (SQLite), tables mirror the old Sheet tabs (`schema.sql`).
- **Auth:** same HMAC-SHA256 token format + legacy MD5 password hashes preserved.

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
npm run db:init:local     # create tables
npm run db:seed:local     # load the data
```

> `seed/*.csv` and `seed/seed.sql` are gitignored — they hold password hashes and
> league join secrets. Keep them off the public repo.

## 2. Local dev server

```bash
cp .dev.vars.example .dev.vars     # set SESSION_SECRET (any string for dev)
npm run dev                        # wrangler dev → http://localhost:8787
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
npx wrangler d1 create wc26          # paste the printed database_id into wrangler.toml
npm run db:init:remote
npm run db:seed:remote               # re-export fresh CSVs + npm run seed:build first
npx wrangler secret put SESSION_SECRET
npm run deploy                       # prints the Worker URL
```

Cutover: set `SCRIPT_URL` in `index.html` to the deployed Worker URL and push.

### Notes

- To keep existing logins valid after cutover, set `SESSION_SECRET` to the old
  Apps Script value (editor → Project Settings → Script Properties). Otherwise
  everyone just logs in once.
- `FIXTURES_URL` (in `wrangler.toml`) is only used to compute locked games; it can
  stay pointed at the same hosted fixtures file the frontend uses.
- Admin edits (add a league, link two players) are now SQL, e.g.:
  `npx wrangler d1 execute wc26 --remote --command "INSERT INTO leagues VALUES ('friends','Friends','joinpw');"`
