-- CUTOVER STEP 1 — drop the old (league,name)-scoped tables so schema_v2.sql can
-- create the v2 monolith tables cleanly (CREATE TABLE IF NOT EXISTS would otherwise
-- skip the pre-existing leagues/guesses, leaving the old columns in place).
--
-- SAFE: a full backup (backup-wc26-<date>.sql) + a Time Travel bookmark were taken
-- first, so this is fully recoverable. Indexes drop with their tables.
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS links;
DROP TABLE IF EXISTS guesses;
DROP TABLE IF EXISTS leagues;
