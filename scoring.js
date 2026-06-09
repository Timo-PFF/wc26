/* World Cup Prediction Pool — scoring rule + per-guess points
 * ----------------------------------------------------------------------------
 * Loaded as a plain <script> before index.html's inline script, so these are
 * global (no modules / build step — must work as static files on GitHub Pages).
 * Pure logic: no DOM, no app state.
 *
 * GROUP games (scoreGroup):
 *   exact score → 3 · right winner + goal difference → 2 · right winner or a
 *   correctly-called draw → 1 · else 0.
 *
 * KNOCKOUT games (scorePick) — a guess picks either an outright winner or a draw
 * (+ a penalty winner). `decidedBy` is "regulation" | "extra_time" | "penalties"
 * (penalties means a draw after extra time). `m.winner` is the side that
 * advanced ("home"/"away"); for a shootout that's the penalty winner.
 *
 *   (a) Guess has an outright winner (gHome != gAway):
 *         decided before penalties + correct winner ............ 2
 *           + correct goal difference ........................... 3
 *           + exact score ....................................... 4
 *         went to penalties + your winner won the shootout ..... 1
 *         else .................................................. 0
 *   (b) Guess is a draw (+ guess.penaltyWinner = "home"/"away"):
 *         decided before penalties + your penalty pick advanced . 1
 *         draw after extra time (correctly called) ............. 2
 *           + exact (draw) score ................................ +1
 *           + correct penalty winner ............................ +1   (so 2–4)
 *         else .................................................. 0
 */

const SCORING = { exact: 3, goalDifference: 2, outcome: 1 };

// Knockout point values (see the rules panel + scorePick below).
const KO_SCORING = {
  exact: 4,             // outright winner guess, exact score before penalties
  goalDifference: 3,    // outright winner guess, correct winner + goal difference
  winner: 2,            // outright winner guess, correct winner only
  shootoutCalled: 1,    // outright winner guess, went to penalties, your team advanced
  drawBase: 2,          // draw guess that really was a draw after extra time
  drawExactBonus: 1,    // + your exact (draw) score was right
  drawPenBonus: 1,      // + you also picked the correct penalty winner
  penWinnerDecisive: 1, // draw guess, game decided in 90/120', your pen pick advanced
};

function isKnockout(m) {
  const s = m && m.stage;
  return !!(s && (s.knockout || (s.slug && s.slug !== 'group-stage')));
}

// Group-stage points.
function scoreGroup(gHome, gAway, aHome, aAway) {
  if (gHome === aHome && gAway === aAway) return SCORING.exact;
  const go = Math.sign(gHome - gAway), ao = Math.sign(aHome - aAway);
  if (go !== ao) return 0;                                  // wrong winner / draw mismatch
  if (go === 0) return SCORING.outcome;                     // correct draw, wrong score
  if ((gHome - gAway) === (aHome - aAway)) return SCORING.goalDifference;
  return SCORING.outcome;                                   // right winner only
}

// Points for one guess against a match. guess = { home, away, penaltyWinner? }.
function scorePick(guess, m) {
  const aHome = m && m.home ? m.home.score : null;
  const aAway = m && m.away ? m.away.score : null;
  if (aHome == null || aAway == null) return 0;             // no result yet
  const gHome = guess.home, gAway = guess.away;

  if (!isKnockout(m)) return scoreGroup(gHome, gAway, aHome, aAway);

  const pens = (m.decidedBy || 'regulation') === 'penalties';
  const advancer = m.winner;                                // 'home' | 'away'
  const exact = gHome === aHome && gAway === aAway;

  if (gHome !== gAway) {
    // (a) picked an outright winner
    const predWinner = gHome > gAway ? 'home' : 'away';
    if (pens) return predWinner === advancer ? KO_SCORING.shootoutCalled : 0;   // went to pens; right side advanced
    if (predWinner !== advancer) return 0;
    if (exact) return KO_SCORING.exact;
    if ((gHome - gAway) === (aHome - aAway)) return KO_SCORING.goalDifference;   // correct goal difference
    return KO_SCORING.winner;                               // correct winner only
  }

  // (b) picked a draw + a penalty winner
  const penPick = guess.penaltyWinner;                      // 'home' | 'away'
  if (!pens) return penPick === advancer ? KO_SCORING.penWinnerDecisive : 0;     // decisive game; you called the advancer
  let pts = KO_SCORING.drawBase;                            // correctly predicted a draw
  if (exact) pts += KO_SCORING.drawExactBonus;              // exact draw score
  if (penPick === advancer) pts += KO_SCORING.drawPenBonus; // correct penalty winner
  return pts;
}
