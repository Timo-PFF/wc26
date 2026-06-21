/* World Cup Prediction Pool — knockout bracket structure
 * ----------------------------------------------------------------------------
 * Loaded as a plain <script> (no modules / build) after scoring.js, so it can
 * use isKnockout(). Pure logic only: no DOM, no app state, no i18n — the tab
 * renderer in index.html turns this structure into HTML.
 *
 * The bracket linkage (which two matches' winners meet) is NOT derivable from
 * the fixtures: ESPN labels feeders only as "Round of 32 N Winner", where N is a
 * fixed bracket-position number that the feed never ties to a real match. So we
 * pass in the connectivity explicitly — `feederMap` maps a match id to the two
 * feeder match ids whose winners play it — built from
 * data/wc2026_knockout_bracket.json (resolved against the official FIFA bracket).
 * Keying by id means it keeps working as ESPN fills placeholders with real teams.
 *
 * buildBracket() folds that bracket into the two halves that meet at the final,
 * each ordered so a pre-order (home-feeder-first) walk lists every round left
 * to right. The renderer stacks the top half downward, the final in the middle,
 * and the bottom half upward — teams enter top and bottom, converge on the final.
 */

// Knockout matches grouped by stage slug, each sorted by numeric id (only used
// for the flat fallback layout and to locate the final / 3rd-place match).
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

// Build the folded bracket from a full fixtures list + a feeder map
// (matchId -> [homeFeederId, awayFeederId]). Returns:
//   { empty }                                  — no knockout games at all
//   { empty:false, folded:false, rounds }      — no/!enough linkage; render flat
//   { empty:false, folded:true, rounds, topRows, bottomRows, final, third }
// topRows/bottomRows are { <slug>: [matches left→right] } for one half each.
function buildBracket(matches, feederMap) {
  const rounds = koRoundsBySlug(matches);
  const koCount = Object.values(rounds).reduce((n, l) => n + l.length, 0);
  if (!koCount) return { empty: true };

  const byId = {};
  (matches || []).forEach(m => { byId[m.id] = m; });
  feederMap = feederMap || {};

  // The two matches that feed `m` (null for round-of-32 leaves or missing
  // linkage), looked up by id — independent of whether the teams are resolved.
  const feedersOf = m => {
    const f = feederMap[m.id];
    if (!f) return [null, null];
    return [byId[f[0]] || null, byId[f[1]] || null];
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
