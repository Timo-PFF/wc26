-- World Cup Prediction Pool — D1 schema.
-- One table per old Google-Sheet tab. Run once against local and (later) remote:
--   npx wrangler d1 execute wc26 --local  --file=schema.sql
--   npx wrangler d1 execute wc26 --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS leagues (
  id       TEXT PRIMARY KEY,          -- league slug, e.g. 'family'
  name     TEXT NOT NULL,             -- display name
  password TEXT NOT NULL DEFAULT ''   -- plaintext join secret (organiser-set)
);

CREATE TABLE IF NOT EXISTS players (
  league   TEXT NOT NULL,
  name     TEXT NOT NULL,
  passHash TEXT NOT NULL DEFAULT '',  -- MD5 of the personal password (legacy)
  PRIMARY KEY (league, name)
);

-- One row per (league, player, matchId): saving a pick is an upsert on this key,
-- which is why savePicks can use INSERT OR REPLACE instead of delete-then-append.
CREATE TABLE IF NOT EXISTS guesses (
  league        TEXT NOT NULL,
  ts            TEXT,                 -- ISO timestamp of last write (bookkeeping)
  player        TEXT NOT NULL,
  matchId       TEXT NOT NULL,
  guessHome     INTEGER,
  guessAway     INTEGER,
  penaltyWinner TEXT NOT NULL DEFAULT '',  -- 'home' | 'away' | '' (knockout draws)
  PRIMARY KEY (league, player, matchId)
);

CREATE TABLE IF NOT EXISTS links (
  linkId TEXT NOT NULL,               -- rows sharing a linkId = same person
  league TEXT NOT NULL,
  name   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guesses_league ON guesses (league);
CREATE INDEX IF NOT EXISTS idx_links_linkid ON links (linkId);
