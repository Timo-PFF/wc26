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

// Whether the "Fav by 1" benchmark applies. Only true for per-pick scoring, where a
// player's points depend on their own pick alone (a pool/consensus scheme has no
// coherent slot for a synthetic non-participant).
const FAV_BOT = true;

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

// Rules-panel HTML (both languages) for THIS scoring module — owned here so a
// tournament with a different ruleset renders its own rules. index.html calls
// scoringRulesHtml(LANG); values come from the SCORING / KO_SCORING above.
function scoringRulesHtml(lang) {
  const g = SCORING, k = KO_SCORING;
  if (lang === 'de') {
    return '<h2 class="rules-title">Wertung</h2>' +
      '<div class="rules-sub">Gruppenphase</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + g.exact + '</b> — exaktes Ergebnis (inkl. exaktes Remis)</li>' +
        '<li><b>' + g.goalDifference + '</b> — richtiger Sieger + Tordifferenz</li>' +
        '<li><b>' + g.outcome + '</b> — richtiger Sieger oder korrekt getipptes Remis</li>' +
        '<li><b>0</b> — sonst</li>' +
      '</ul>' +
      '<div class="rules-sub">K.-o.-Phase</div>' +
      '<p class="rules-note">Du tippst entweder einen Sieger oder ein Remis — beim Remis wählst du zusätzlich, wer das Elfmeterschießen gewinnt. Die Anzahl der verwandelten Elfmeter zählt nie: nur das Ergebnis nach 90/120 Minuten und, falls es so weit kommt, welches Team im Elfmeterschießen gewinnt.</p>' +
      '<div class="rules-mode">Wenn du einen <b>Sieger</b> tippst:</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.exact + '</b> — exaktes Ergebnis (vor dem Elfmeterschießen)</li>' +
        '<li><b>' + k.goalDifference + '</b> — richtiger Sieger + Tordifferenz</li>' +
        '<li><b>' + k.winner + '</b> — richtiger Sieger</li>' +
        '<li><b>' + k.shootoutCalled + '</b> — es ging ins Elfmeterschießen und dein getipptes Team hat gewonnen</li>' +
        '<li><b>0</b> — falscher Sieger</li>' +
      '</ul>' +
      '<div class="rules-mode">Wenn du ein <b>Remis</b> tippst (und einen Elfmeter-Sieger wählst):</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.drawBase + '</b> — es war wirklich ein Remis nach Verlängerung</li>' +
        '<li><b>+' + k.drawExactBonus + '</b> — dein exaktes Ergebnis (nach Verlängerung) stimmt</li>' +
        '<li><b>+' + k.drawPenBonus + '</b> — du hast auch den richtigen Elfmeter-Sieger getippt (perfekter Tipp = ' + (k.drawBase + k.drawExactBonus + k.drawPenBonus) + ')</li>' +
        '<li><b>' + k.penWinnerDecisive + '</b> — das Spiel wurde in regulärer Zeit/Verlängerung entschieden, aber das von dir beim Elfmeterschießen gewählte Team ist weitergekommen</li>' +
        '<li><b>0</b> — sonst</li>' +
      '</ul>' +
      '<p class="rules-note">Gleichstand in der Tabelle: meiste exakte Tipps, dann Tordifferenz-Treffer.</p>';
  }
  return '<h2 class="rules-title">Scoring rules</h2>' +
    '<div class="rules-sub">Group stage</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + g.exact + '</b> — exact score (incl. exact draw)</li>' +
      '<li><b>' + g.goalDifference + '</b> — correct winner + goal difference</li>' +
      '<li><b>' + g.outcome + '</b> — correct winner, or a correctly predicted draw</li>' +
      '<li><b>0</b> — otherwise</li>' +
    '</ul>' +
    '<div class="rules-sub">Knockout stage</div>' +
    '<p class="rules-note">You predict either an outright winner or a draw — and for a draw you also pick who wins the shootout. The number of penalties scored never matters: only the result after 90/120 minutes and, if it goes that far, which team wins on penalties.</p>' +
    '<div class="rules-mode">If you predict an outright <b>winner</b>:</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + k.exact + '</b> — exact score (before penalties)</li>' +
      '<li><b>' + k.goalDifference + '</b> — correct winner + goal difference</li>' +
      '<li><b>' + k.winner + '</b> — correct winner</li>' +
      '<li><b>' + k.shootoutCalled + '</b> — it went to penalties and the team you picked won the shootout</li>' +
      '<li><b>0</b> — wrong winner</li>' +
    '</ul>' +
    '<div class="rules-mode">If you predict a <b>draw</b> (and pick a penalty winner):</div>' +
    '<ul class="rules-list">' +
      '<li><b>' + k.drawBase + '</b> — it really was a draw after extra time</li>' +
      '<li><b>+' + k.drawExactBonus + '</b> — your exact score (after extra time) was right</li>' +
      '<li><b>+' + k.drawPenBonus + '</b> — you also picked the correct penalty winner (so a perfect call = ' + (k.drawBase + k.drawExactBonus + k.drawPenBonus) + ')</li>' +
      '<li><b>' + k.penWinnerDecisive + '</b> — the game was decided in normal/extra time, but the team you picked on penalties is the one that advanced</li>' +
      '<li><b>0</b> — otherwise</li>' +
    '</ul>' +
    '<p class="rules-note">Standings tie-break: most exact-score hits, then goal-difference hits.</p>';
}
