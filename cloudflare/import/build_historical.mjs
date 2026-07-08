/* Build the committed static snapshot of finished-match guesses.
 *
 * Reads the fixtures (to know which matches are COMPLETED) and the local seed
 * export (seed/guesses.csv), and writes data/wc2026_historical_guesses.csv — one
 * row per (league, player, matchId) for every completed match. Those picks are
 * final and already public, so the file is safe to commit.
 *
 * The Worker derives "active" (live) matches at runtime as the fixture matchIds
 * that never appear in this snapshot, so the split needs no hardcoded ids. Run once
 * per freeze point: npm run historical:build
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTable } from './csv.mjs';

const seedPath = (n) => fileURLToPath(new URL('../seed/' + n, import.meta.url));
const dataPath = (n) => fileURLToPath(new URL('../../data/' + n, import.meta.url));

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Completed matches from the fixtures — their picks are final and get frozen.
const fixtures = JSON.parse(readFileSync(dataPath('wc2026_fixtures.json'), 'utf8'));
const completed = new Set(
  (fixtures.matches || []).filter((m) => m.status && m.status.completed).map((m) => String(m.id)),
);

const rows = readTable(seedPath('guesses.csv'), [
  'league', 'timestamp', 'player', 'matchId', 'guessHome', 'guessAway', 'penaltyWinner',
]);
if (!rows) throw new Error('seed/guesses.csv not found — export the Sheet first');

// Dedup to one row per (league, player, matchId), last wins; keep only completed matches.
const byKey = new Map();
for (const r of rows) {
  const league = String(r.league).trim();
  const player = String(r.player).trim();
  const matchId = String(r.matchId).trim();
  if (!league || !player || !matchId) continue;
  if (!completed.has(matchId)) continue; // only finished matches are frozen
  byKey.set(`${norm(league)}${norm(player)}${matchId}`, {
    league, player, matchId,
    home: String(r.guessHome ?? '').trim(),
    away: String(r.guessAway ?? '').trim(),
    pen: (r.penaltyWinner === 'home' || r.penaltyWinner === 'away') ? r.penaltyWinner : '',
  });
}

// Unquoted CSV so the Worker + browser parse by a simple split — assert no field
// needs escaping (our data is league slugs / first names / digits only).
const needsEscaping = /[",\r\n]/;
const out = ['league,player,matchId,home,away,penaltyWinner'];
for (const g of byKey.values()) {
  const fields = [g.league, g.player, g.matchId, g.home, g.away, g.pen];
  for (const f of fields) {
    if (needsEscaping.test(String(f))) {
      throw new Error(`Field needs CSV escaping ("${f}") — add quoting to the snapshot format`);
    }
  }
  out.push(fields.join(','));
}

writeFileSync(dataPath('wc2026_historical_guesses.csv'), out.join('\n') + '\n', 'utf8');
console.log(
  `Wrote data/wc2026_historical_guesses.csv — ${byKey.size} finished-match picks ` +
  `(${completed.size} completed matches).`,
);
