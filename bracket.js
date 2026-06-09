/* World Cup Prediction Pool — knockout bracket structure
 * ----------------------------------------------------------------------------
 * Loaded as a plain <script> (no modules / build) after scoring.js, so it can
 * use isKnockout(). Pure logic only: no DOM, no app state, no i18n — the tab
 * renderer in index.html turns this structure into HTML.
 *
 * Within each round the matches are numbered 1..n in match-id order (ESPN keeps
 * ids in match-number order). The 2026 bracket linkage between those numbers is
 * fixed and published, so we hard-code it once in KO_LINKAGE. We deliberately do
 * NOT read it from the placeholder opponent names ("Round of 32 3 Winner"),
 * because ESPN overwrites those with the real teams as the bracket fills — the
 * linkage has to keep working once games are played.
 *
 * buildBracket() folds that bracket into the two halves that meet at the final,
 * each ordered so a pre-order (home-feeder-first) walk lists every round left
 * to right. The renderer stacks the top half downward, the final in the middle,
 * and the bottom half upward — teams enter top and bottom, converge on the final.
 */

// For each round, which previous-round match numbers (1-based) feed each match,
// in that round's match-id order. This is the fixed 2026 bracket.
const KO_LINKAGE = {
  'round-of-16':   { from: 'round-of-32',   feeders: [[1, 3], [2, 5], [4, 6], [7, 8], [11, 12], [9, 10], [13, 15], [14, 16]] },
  'quarterfinals': { from: 'round-of-16',   feeders: [[1, 2], [5, 6], [3, 4], [7, 8]] },
  'semifinals':    { from: 'quarterfinals', feeders: [[1, 2], [3, 4]] },
  'final':         { from: 'semifinals',    feeders: [[1, 2]] },
};

// Knockout matches grouped by stage slug, each sorted by numeric id. That id
// order is the 1..n match numbering KO_LINKAGE refers to.
function koRoundsBySlug(matches) {
  const rounds = {};
  (matches || []).filter(isKnockout).forEach(m => {
    const slug = (m.stage || {}).slug || 'knockout';
    (rounds[slug] = rounds[slug] || []).push(m);
  });
  Object.values(rounds).forEach(list =>
    list.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0)));
  return rounds;
}

// Build the folded bracket from a full fixtures list. Returns:
//   { empty }                                  — no knockout games at all
//   { empty:false, folded:false, rounds }      — structure unexpected; render flat
//   { empty:false, folded:true, rounds, topRows, bottomRows, final, third }
// topRows/bottomRows are { <slug>: [matches left→right] } for one half each.
function buildBracket(matches) {
  const rounds = koRoundsBySlug(matches);
  const koCount = Object.values(rounds).reduce((n, l) => n + l.length, 0);
  if (!koCount) return { empty: true };

  // The two matches that feed `m` (null for leaves / unknown linkage), looked up
  // purely by match position — independent of whether the teams are resolved.
  const feedersOf = m => {
    const slug = (m.stage || {}).slug;
    const link = KO_LINKAGE[slug];
    if (!link) return [null, null];               // round-of-32 / 3rd-place
    const pos = (rounds[slug] || []).indexOf(m);  // 0-based match number
    const pair = pos >= 0 ? link.feeders[pos] : null;
    if (!pair) return [null, null];
    const prev = rounds[link.from] || [];
    return [prev[pair[0] - 1] || null, prev[pair[1] - 1] || null];
  };

  const final = (rounds['final'] || [])[0] || null;
  const third = (rounds['3rd-place-match'] || [])[0] || null;

  // Collect one half of the draw, descending from a semifinal. Pre-order with
  // the home feeder first means each round's list comes out left-to-right.
  function collectHalf(sf) {
    const rows = { 'semifinals': [], 'quarterfinals': [], 'round-of-16': [], 'round-of-32': [] };
    (function dfs(m) {
      if (!m) return;
      const slug = (m.stage || {}).slug;
      if (rows[slug]) rows[slug].push(m);
      const f = feedersOf(m);
      dfs(f[0]);
      dfs(f[1]);
    })(sf);
    return rows;
  }

  if (final) {
    const [sfTop, sfBottom] = feedersOf(final);
    if (sfTop && sfBottom) {
      return {
        empty: false, folded: true, rounds, final, third,
        topRows: collectHalf(sfTop),
        bottomRows: collectHalf(sfBottom),
      };
    }
  }
  return { empty: false, folded: false, rounds };
}
