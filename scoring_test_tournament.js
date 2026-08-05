/* Prediction Pool — TEST scoring module: CONSENSUS (parimutuel) pool.
 * ----------------------------------------------------------------------------
 * A game-interdependent scheme (a player's points for a game depend on everyone
 * else's picks), so it can't be a pure scorePick(). It exposes an extra
 * gamePoints(m, gameGuesses, players) that the app uses to distribute each game's
 * points; computeStandings / the points chart call it when present.
 *
 * Per game: a FIXED pool — 3·N (group) or 4·N (knockout), N = players — is split
 * in proportion to each player's STANDARD points (scorePick below). A per-player
 * cap (N group, 4⁄3·N knockout) rescales the whole game down if the top would
 * exceed it. Nobody scores a game → nobody gets points for it.
 *
 * Module contract used by the app: scorePick(guess, m), isKnockout(m),
 * scoringRulesHtml(lang), and (optional) gamePoints(m, gameGuesses, players).
 */

// No "Fav by 1" benchmark: the pool is game-interdependent, so a synthetic
// non-participant has no coherent place in it.
const FAV_BOT = false;

// Standard points — these only set the PROPORTIONS for the pool split.
const SCORING = { exact: 3, goalDifference: 2, outcome: 1 };

const KO_SCORING = {
  exact: 4, goalDifference: 3, winner: 2, shootoutCalled: 1,
  drawBase: 2, drawExactBonus: 1, drawPenBonus: 1, penWinnerDecisive: 1,
};

function isKnockout(m) {
  const s = m && m.stage;
  return !!(s && (s.knockout || (s.slug && s.slug !== 'group-stage')));
}

function scoreGroup(gHome, gAway, aHome, aAway) {
  if (gHome === aHome && gAway === aAway) return SCORING.exact;
  const go = Math.sign(gHome - gAway), ao = Math.sign(aHome - aAway);
  if (go !== ao) return 0;
  if (go === 0) return SCORING.outcome;
  if ((gHome - gAway) === (aHome - aAway)) return SCORING.goalDifference;
  return SCORING.outcome;
}

// Standard per-pick points (the "raw" score that sets each player's pool share).
function scorePick(guess, m) {
  const aHome = m && m.home ? m.home.score : null;
  const aAway = m && m.away ? m.away.score : null;
  if (aHome == null || aAway == null) return 0;
  const gHome = guess.home, gAway = guess.away;

  if (!isKnockout(m)) return scoreGroup(gHome, gAway, aHome, aAway);

  const pens = (m.decidedBy || 'regulation') === 'penalties';
  const advancer = m.winner;
  const exact = gHome === aHome && gAway === aAway;

  if (gHome !== gAway) {
    const predWinner = gHome > gAway ? 'home' : 'away';
    if (pens) return predWinner === advancer ? KO_SCORING.shootoutCalled : 0;
    if (predWinner !== advancer) return 0;
    if (exact) return KO_SCORING.exact;
    if ((gHome - gAway) === (aHome - aAway)) return KO_SCORING.goalDifference;
    return KO_SCORING.winner;
  }

  const penPick = guess.penaltyWinner;
  if (!pens) return penPick === advancer ? KO_SCORING.penWinnerDecisive : 0;
  let pts = KO_SCORING.drawBase;
  if (exact) pts += KO_SCORING.drawExactBonus;
  if (penPick === advancer) pts += KO_SCORING.drawPenBonus;
  return pts;
}

// Consensus pool for ONE finished game -> { player: points }. gameGuesses = the
// guesses for this match; players = the full player list (sets N + the pool/cap).
function gamePoints(m, gameGuesses, players) {
  const N = (players || []).length || 1;
  const ko = isKnockout(m);
  const pool = (ko ? 4 : 3) * N;
  const cap = (ko ? 4 / 3 : 1) * N;

  const raw = {};
  let total = 0;
  (gameGuesses || []).forEach((g) => {
    const r = scorePick(g, m);
    if (r > 0) { raw[g.player] = (raw[g.player] || 0) + r; total += r; }
  });

  const out = {};
  if (total <= 0) return out;                 // nobody scored -> no points handed out

  let mx = 0;
  Object.keys(raw).forEach((p) => { const v = raw[p] * pool / total; out[p] = v; if (v > mx) mx = v; });
  if (mx > cap) {                             // cap: rescale the whole game so the top = cap
    const f = cap / mx;
    Object.keys(out).forEach((p) => { out[p] *= f; });
  }
  return out;
}

// Rules panel (both languages) for the consensus scheme. Point values come from
// this module's SCORING / KO_SCORING (the raw scores that set the proportions).
function scoringRulesHtml(lang) {
  const g = SCORING, k = KO_SCORING;
  if (lang === 'de') {
    return '<h2 class="rules-title">Wertung — Konsens-Pool</h2>' +
      '<p class="rules-note">Jedes Spiel verteilt einen <b>festen Punkte-Pool</b> auf alle Mitspieler: <b>3 × N</b> in der Gruppenphase, <b>4 × N</b> in der K.-o.-Phase (N = Anzahl Mitspieler). Der Pool wird im Verhältnis zu den <b>Standardpunkten</b> aufgeteilt, die jede/r im Spiel holt — richtig zu liegen, wenn es kaum jemand tut, ist also viel mehr wert als ein Tipp, den alle haben.</p>' +
      '<div class="rules-sub">Standardpunkte (bestimmen die Anteile)</div>' +
      '<div class="rules-mode">Gruppenphase:</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + g.exact + '</b> — exaktes Ergebnis · <b>' + g.goalDifference + '</b> — Sieger + Tordifferenz · <b>' + g.outcome + '</b> — Sieger oder korrektes Remis · <b>0</b> — sonst</li>' +
      '</ul>' +
      '<div class="rules-mode">K.-o. (Sieger getippt):</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.exact + '</b> exakt · <b>' + k.goalDifference + '</b> Sieger + TD · <b>' + k.winner + '</b> Sieger · <b>' + k.shootoutCalled + '</b> Elfmeterschießen und dein Team kam weiter</li>' +
      '</ul>' +
      '<div class="rules-mode">K.-o. (Remis + Elfmeter-Sieger getippt):</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.drawBase + '</b> Basis · <b>+' + k.drawExactBonus + '</b> exaktes Remis · <b>+' + k.drawPenBonus + '</b> richtiger Elfmeter-Sieger · <b>' + k.penWinnerDecisive + '</b> in der Zeit entschieden, aber dein Elfmeter-Team kam weiter</li>' +
      '</ul>' +
      '<div class="rules-sub">Deckel</div>' +
      '<p class="rules-note">Aus einem einzelnen Spiel bekommt niemand mehr als <b>N</b> (Gruppe) bzw. <b>4⁄3 × N</b> (K.-o.). Würde die/der Beste mehr holen, werden alle Punkte des Spiels so herunterskaliert, dass die/der Beste genau auf dem Deckel liegt. Holt niemand Punkte, gibt es für das Spiel keine.</p>';
  }
  return '<h2 class="rules-title">Scoring rules — consensus pool</h2>' +
    '<p class="rules-note">Each game shares out a <b>fixed pool</b> of points among all players: <b>3 × N</b> in the group stage and <b>4 × N</b> in the knockouts, where N is the number of players. The pool is split in proportion to the <b>standard points</b> each player earns that game — so a correct pick that few others got is worth far more than one everyone got.</p>' +
    '<div class="rules-sub">Standard points (set the proportions)</div>' +
    '<div class="rules-mode">Group stage:</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + g.exact + '</b> — exact score · <b>' + g.goalDifference + '</b> — winner + goal difference · <b>' + g.outcome + '</b> — correct winner or draw · <b>0</b> — otherwise</li>' +
    '</ul>' +
    '<div class="rules-mode">Knockout (predict a winner):</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + k.exact + '</b> exact · <b>' + k.goalDifference + '</b> winner + GD · <b>' + k.winner + '</b> winner · <b>' + k.shootoutCalled + '</b> went to pens and your side advanced</li>' +
    '</ul>' +
    '<div class="rules-mode">Knockout (predict a draw + penalty winner):</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + k.drawBase + '</b> base · <b>+' + k.drawExactBonus + '</b> exact draw score · <b>+' + k.drawPenBonus + '</b> correct penalty winner · <b>' + k.penWinnerDecisive + '</b> decided in play but your pen pick advanced</li>' +
    '</ul>' +
    '<div class="rules-sub">Cap</div>' +
    '<p class="rules-note">No one can take more than <b>N</b> (group) or <b>4⁄3 × N</b> (knockout) from a single game. If the top scorer would exceed that, everyone\'s points that game are scaled down so the top sits exactly at the cap. If nobody scores a game, nobody gets points for it.</p>';
}
