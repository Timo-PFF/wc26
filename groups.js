/* World Cup Prediction Pool — group-stage table computation
 * ----------------------------------------------------------------------------
 * Loaded as a plain <script> before index.html's inline script. Pure data, no
 * DOM — index.html turns the result into HTML (tables + head-to-head grids).
 *
 * Relies on the global team accessors defined in index.html
 * (teamAbbr / teamName / isFinished / homeScore / awayScore), since all classic
 * scripts share one global scope here.
 *
 * computeGroups(matches) -> ordered object keyed by group letter:
 *   { A: { teams: [ {side, played, gf, ga, gd, pts}, … ], matches: [ … ] }, … }
 * Teams are sorted by points, then goal difference, then goals scored, then
 * name (the World Cup tiebreaker order). 3 pts for a win, 1 for a draw.
 */

function computeGroups(matches) {
  const groups = {};        // letter -> { teamKey -> {side, gf, ga, pts, played} }
  const groupMatches = {};  // letter -> [matches]

  matches.forEach(m => {
    if ((m.stage || {}).slug !== 'group-stage' || !m.group) return;
    (groupMatches[m.group] = groupMatches[m.group] || []).push(m);
    const g = (groups[m.group] = groups[m.group] || {});
    [m.home, m.away].forEach(side => {
      const k = teamAbbr(side);
      if (!g[k]) g[k] = { side: side, gf: 0, ga: 0, pts: 0, played: 0 };
    });
    const hs = homeScore(m), as = awayScore(m);
    if (isFinished(m) && hs != null && as != null) {
      const H = g[teamAbbr(m.home)], A = g[teamAbbr(m.away)];
      H.gf += hs; H.ga += as; H.played++;
      A.gf += as; A.ga += hs; A.played++;
      if (hs > as) H.pts += 3; else if (as > hs) A.pts += 3; else { H.pts++; A.pts++; }
    }
  });

  const result = {};
  Object.keys(groups).sort().forEach(letter => {
    const teams = Object.keys(groups[letter]).map(k => {
      const r = groups[letter][k];
      return { side: r.side, played: r.played, gf: r.gf, ga: r.ga, gd: r.gf - r.ga, pts: r.pts };
    }).sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || teamName(a.side).localeCompare(teamName(b.side)));
    result[letter] = { teams: teams, matches: groupMatches[letter] || [] };
  });
  return result;
}
