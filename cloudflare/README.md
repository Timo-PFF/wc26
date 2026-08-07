# wc26 backend — Cloudflare Worker + D1 (v2, global-users monolith)

**One** Worker + **one** D1 serve **every** tournament. A user is a global identity
(one login across all tournaments); they join per-tournament *leagues*; their picks
are one set per tournament, shared across the leagues they joined. Each tournament's
fixtures + finished-guesses snapshot are resolved at runtime from the committed
manifest `data/tournaments.json` — so adding a tournament needs **no** Worker or
config change.

- **Runtime:** `src/worker_v2.js` (router) → `handlers_v2.js` →
  `db_v2.js` / `auth_v2.js` (→ `hmac.js`) / `locks_v2.js` / `md5.js`.
- **Store:** D1 (SQLite), `schema_v2.sql` — `users`, `leagues`, `memberships`,
  `guesses` (see the file for columns; users carry an `admin` flag).
- **Auth:** global HMAC-SHA256 session token (`{u: userId, n: name}`); legacy MD5
  password hashes preserved. `SESSION_SECRET` signs the token.
- **Reads (D1 stays tiny):** picks for finished matches are frozen in a committed
  per-tournament snapshot `data/<tid>/<tid>_historical_guesses.csv` (per-player:
  `player,matchId,home,away,penaltyWinner`). The Worker serves only the **live**
  matches — fixture ids **not** in that snapshot — and the frontend merges the two.
  The split is derived from the snapshot at runtime (no hardcoded ids), so an
  archived tournament (snapshot covers every game) does **zero** D1 reads.
- **Config var:** `REPO_BASE` (in `wrangler.toml`) — the raw repo root the Worker
  fetches the manifest + per-tournament files from. (This replaced the old
  `FIXTURES_URL` / `SNAPSHOT_URL` pair.)
- **Admin console:** `admin.html` (a separate page) drives the `admin*` endpoints,
  gated by `users.admin`. See "Admin" below.

Everything below **local** works with no Cloudflare account; you only need the (free)
account for the deploy step.

## 0. Prereqs

- Node 18+ and npm.
- `cd cloudflare && npm install` (installs `wrangler` locally).

## 1. Seed a local D1

The seed SQL (`seed/seed_v2.sql`) and the per-tournament snapshot CSVs are (re)built
by `python/migrate_v2.py` from the D1 JSON exports in `seed/`. Then:

```bash
npm run db:init:local     # apply schema_v2.sql   (local D1, via wrangler.v2.toml)
npm run db:seed:local     # load seed/seed_v2.sql
```

> `seed/*.csv`, `seed/*.json`, `seed/*.sql`, and `backup-*.sql` are gitignored — they
> hold password hashes and league join codes. Keep them off the public repo. Only the
> per-tournament **finished-guesses** snapshot under `data/<tid>/…` is committed
> (completed-game picks are already visible to pool members).

Local dev uses `wrangler.v2.toml`, which keys its own local D1 namespace and points
`REPO_BASE` at the live raw repo (so `wrangler dev` — which can't fetch loopback —
still resolves the manifest + snapshots).

## 2. Local dev server

```bash
cp .dev.vars.example .dev.vars     # set SESSION_SECRET (any string for dev)
npm run dev                        # wrangler dev → http://localhost:8787
```

Smoke test (a tournament id is required — `t=`):

```bash
curl "http://localhost:8787/?action=leagues&t=wc2026"
curl "http://localhost:8787/?action=members&t=wc2026&league=family"
```

## 3. Test the real frontend against local D1

Open the site with an `?api=` override pointing at the local Worker — no file edit:

```
index.html?api=http://localhost:8787
```

Log in, make picks, check standings — all reads/writes now hit local D1. The admin
console is `admin.html?api=http://localhost:8787` (it also reuses the app's session).

## 4. Deploy (needs a free Cloudflare account)

```bash
npx wrangler login
npx wrangler d1 create wc26          # first time only; paste database_id into wrangler.toml
npm run db:init:remote               # apply schema_v2.sql (idempotent)
npm run db:seed:remote               # first time only; loads seed/seed_v2.sql
npx wrangler secret put SESSION_SECRET
npm run deploy                       # prints the Worker URL
```

Frontend deploys separately (GitHub Pages). Ordering only matters when a change spans
both: push the frontend first (a still-old Worker keeps working — the frontend merges
the committed snapshot), then `npm run deploy` the Worker. Schema changes that the new
Worker code reads (e.g. adding the `admin` column) must be applied to the remote D1
**before** deploying that Worker.

## Adding a tournament (the v2 way)

No new Worker, D1, or wrangler environment — the monolith already serves it. Three
committed changes:

1. **Data files** under `data/<tid>/`: fixtures JSON, the finished-guesses snapshot
   CSV, and whatever the frontend reads (fav picks, brackets, groups). See an existing
   tournament (`data/wc2026/`, `data/euro2024/`) for the shape.
2. **Manifest** `data/tournaments.json`: add an entry — `id`, `name`, `default`,
   `api` (the one Worker URL — same for every tournament), `scoring`, and `files`
   pointing at the `data/<tid>/…` files above.
3. **Leagues** in D1: insert rows into `leagues` for the tournament (optionally with
   `inheritsTournamentId` / `inheritsLeagueId` so members of a prior league join
   code-free). `python/migrate_v2.py` can emit these alongside the seed.

That's it — the Worker resolves the new tournament from the manifest at runtime.

## Refreshing the finished-guesses snapshot (during a tournament)

The snapshot (`data/<tid>/<tid>_historical_guesses.csv`) is what keeps D1 reads low —
the Worker only serves games that are **not** in it. `python/refresh_historical.py`
rebuilds a tournament's snapshot from the live D1: it reads the fixtures, finds the
finished games (final score present), pulls those guesses from D1, and rewrites the
CSV in the per-player format.

```bash
python python/refresh_historical.py <tid>            # rebuild from the remote D1
python python/refresh_historical.py <tid> --dry-run  # show counts, write nothing
python python/refresh_historical.py <tid> --local    # against the local D1 (wrangler.v2.toml)
```

Run it where `npx wrangler` is available (WSL). **Commit + push the CSV afterwards** —
the Worker/frontend read it from the raw repo URL, not from D1. Run it periodically as
games finish; each finished game it freezes drops out of D1 read traffic. With no
finished games it writes a header-only CSV, so it also **initializes** the snapshot for
a not-yet-started tournament (needs only the manifest entry + the fixtures file — no
D1 access).

## Admin

`admin.html` is a standalone console (English-only) for one or more users flagged
`admin = 1` in `users`. It calls the admin-gated endpoints
(`adminUsers`, `adminAddMembership`, `adminRemoveMembership`, `adminResetPassword`,
`adminDeleteUser`) and lets you see every user's memberships + inheritance-eligible
leagues, search/filter, add/remove league memberships, reset passwords, and delete
users. The app shows an **⚙ Admin** link (by the login badge) only to admins, and the
console reuses the app's session (same-origin token) so there's no second login.

Grant admin with SQL:

```bash
npx wrangler d1 execute wc26 --remote --command "UPDATE users SET admin=1 WHERE name='Timo';"
```

### Notes

- `REPO_BASE` (in `wrangler.toml`) is the raw repo root the Worker fetches the
  manifest + per-tournament fixtures/snapshot from. Each tournament's live set is
  `fixtures − snapshot`; if either file is unreachable the Worker falls back to
  serving the caller's own picks only.
- Keep `SESSION_SECRET` stable — changing it invalidates every existing session
  (everyone just logs in once more).
- Other admin edits are plain SQL, e.g. add a league:
  `npx wrangler d1 execute wc26 --remote --command "INSERT INTO leagues (tournamentId,id,name,password) VALUES ('wc2026','friends','Friends','joinpw');"`
