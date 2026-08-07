-- v2 schema — global users + per-tournament leagues/memberships/guesses (monolith).
-- Replaces the per-tournament (league, name)-scoped model. A user is a global
-- identity; they join per-tournament leagues; their picks are one set per
-- tournament (shared across every league they're in — no more link/mirroring).

CREATE TABLE IF NOT EXISTS users (
  id       TEXT PRIMARY KEY,       -- stable global id (e.g. u001)
  name     TEXT NOT NULL UNIQUE,   -- global login handle + display name
  passHash TEXT NOT NULL DEFAULT '',
  admin    INTEGER NOT NULL DEFAULT 0,  -- 1 = pool admin (admin.html console access)
  created  TEXT
);

CREATE TABLE IF NOT EXISTS leagues (
  tournamentId         TEXT NOT NULL,
  id                   TEXT NOT NULL,           -- slug, unique within the tournament
  name                 TEXT NOT NULL,
  password             TEXT NOT NULL DEFAULT '',-- join code (plaintext)
  inheritsTournamentId TEXT,                    -- optional: members of THIS prior
  inheritsLeagueId     TEXT,                    --   league may join code-free
  PRIMARY KEY (tournamentId, id)
);

CREATE TABLE IF NOT EXISTS memberships (
  userId       TEXT NOT NULL,
  tournamentId TEXT NOT NULL,
  leagueId     TEXT NOT NULL,
  PRIMARY KEY (userId, tournamentId, leagueId)
);

-- One set of picks per user per tournament, shared across every league they joined.
CREATE TABLE IF NOT EXISTS guesses (
  userId        TEXT NOT NULL,
  tournamentId  TEXT NOT NULL,
  matchId       TEXT NOT NULL,
  guessHome     INTEGER,
  guessAway     INTEGER,
  penaltyWinner TEXT NOT NULL DEFAULT '',
  ts            TEXT,
  PRIMARY KEY (userId, tournamentId, matchId)
);

CREATE INDEX IF NOT EXISTS idx_members_tourn_league ON memberships (tournamentId, leagueId);
CREATE INDEX IF NOT EXISTS idx_guesses_tourn_match  ON guesses (tournamentId, matchId);
CREATE INDEX IF NOT EXISTS idx_guesses_user_tourn   ON guesses (userId, tournamentId);
