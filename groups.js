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
 *
 * Tiebreaker (FIFA 2026 — head-to-head BEFORE overall goal difference):
 * teams level on points are ranked by, in order,
 *   1. points in head-to-head matches among the tied teams,
 *   2. goal difference in those head-to-head matches,
 *   3. goals scored in those head-to-head matches,
 *   4. goal difference in all group matches,
 *   5. goals scored in all group matches.
 * If criteria 1–3 separate only some of the tied teams, they are re-applied to
 * the matches between the teams that are still tied (FIFA's recursion) before
 * dropping to 4–5. Anything beyond that (fair play, drawing of lots) we leave to
 * a name sort here and hard-code by hand if it ever matters. 3 pts win, 1 draw.
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
    });
    result[letter] = { teams: orderGroup(teams, groupMatches[letter] || []), matches: groupMatches[letter] || [] };
  });
  return result;
}

// Which teams have already CLINCHED a group seed. ESPN fills a real team into a
// Round-of-32 slot only once that team has mathematically secured the matching
// group finish, so we detect locks by comparing the pre-tournament R32 bracket
// (`bracket`, placeholder slots keyed by match id) to the live fixtures: a slot
// now holding a real group-stage team means that team is locked into that seed.
// Returns { teamAbbr: { rank, group } } (rank 1=winner, 2=runner-up, 3=third).
function lockedSeeds(matches, bracket) {
  const locked = {};
  if (!bracket || !bracket.matches) return locked;
  const byId = {};
  const groupTeams = new Set();
  matches.forEach(m => {
    byId[m.id] = m;
    if ((m.stage || {}).slug === 'group-stage') {
      groupTeams.add(teamAbbr(m.home));
      groupTeams.add(teamAbbr(m.away));
    }
  });
  bracket.matches.forEach(bm => {
    const m = byId[bm.match_id];
    if (!m) return;
    [['home', bm.home], ['away', bm.away]].forEach(pair => {
      const ab = teamAbbr(m[pair[0]]);
      if (groupTeams.has(ab)) locked[ab] = { rank: pair[1].rank, group: pair[1].group || null };
    });
  });
  return locked;
}

// Order a group's teams: by points, then resolve each equal-points block with the
// head-to-head tiebreaker chain.
function orderGroup(teams, matches) {
  const out = [];
  const byPts = teams.slice().sort((a, b) => b.pts - a.pts);
  let i = 0;
  while (i < byPts.length) {
    let j = i;
    while (j < byPts.length && byPts[j].pts === byPts[i].pts) j++;
    out.push(...breakTie(byPts.slice(i, j), matches));   // teams equal on points
    i = j;
  }
  return out;
}

// Head-to-head mini-table (points / goal difference / goals for) among `teams`,
// using only the FINISHED group matches played between them.
function headToHead(teams, matches) {
  const inSet = new Set(teams.map(t => teamAbbr(t.side)));
  const tab = {};
  teams.forEach(t => { tab[teamAbbr(t.side)] = { pts: 0, gd: 0, gf: 0 }; });
  matches.forEach(m => {
    const h = teamAbbr(m.home), a = teamAbbr(m.away);
    if (!inSet.has(h) || !inSet.has(a) || !isFinished(m)) return;
    const hs = homeScore(m), as = awayScore(m);
    if (hs == null || as == null) return;
    tab[h].gf += hs; tab[h].gd += hs - as;
    tab[a].gf += as; tab[a].gd += as - hs;
    if (hs > as) tab[h].pts += 3; else if (as > hs) tab[a].pts += 3; else { tab[h].pts++; tab[a].pts++; }
  });
  return tab;
}

// Resolve a set of teams that are level on points (FIFA 2026 order, recursive).
function breakTie(tied, matches) {
  if (tied.length === 1) return tied;
  const h2h = headToHead(tied, matches);
  const key = t => h2h[teamAbbr(t.side)];                 // {pts, gd, gf} among the tied set
  const sorted = tied.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    return kb.pts - ka.pts || kb.gd - ka.gd || kb.gf - ka.gf || 0;
  });

  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    const ki = key(sorted[i]);
    while (j < sorted.length) {
      const kj = key(sorted[j]);
      if (kj.pts === ki.pts && kj.gd === ki.gd && kj.gf === ki.gf) j++; else break;
    }
    const block = sorted.slice(i, j);          // teams indistinguishable on head-to-head
    if (block.length === 1) {
      out.push(block[0]);
    } else if (block.length === tied.length) {
      // head-to-head separated nobody -> fall to overall GD, then goals, then name
      out.push(...block.slice().sort((a, b) =>
        b.gd - a.gd || b.gf - a.gf || teamName(a.side).localeCompare(teamName(b.side))));
    } else {
      // a smaller sub-group is still tied -> re-apply head-to-head among just them
      out.push(...breakTie(block, matches));
    }
    i = j;
  }
  return out;
}
