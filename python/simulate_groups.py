#!/usr/bin/env python3
"""
Monte-Carlo the WC2026 group stage and rank every team in every simulation.

Pipeline (all from data/wc2026_fixtures.json):
  1. Simulate every FUTURE group game from its de-vigged closing 3-way moneyline
     (one U(0,1) roll per game per sim -> H / D / A by cumulative probability).
     Finished games keep their actual result in every simulation.
  2. Rank the four teams in each group per sim by points (3/1/0), breaking ties on
     current (finished-games) goal difference, then a random dice.
  3. Report the modal full 48-team finish (its frequency is microscopic — the
     joint space is 24^12, so this just illustrates the dispersion).

Outputs land in --out-dir with the sim count as an exp-notation suffix, e.g.
1e5 for 100,000:
  group_sim_outcomes_<suf>.csv   sim, game_id, group, home, away, finished, outcome
  group_ranks_<suf>.csv          sim, group, team, points, current_gd, rank

Usage:
    python simulate_groups.py --sims 100000
"""

import argparse, csv, json, math, os, collections
import numpy as np


def amer_to_p(ml):
    m = float(ml)
    return 100.0 / (m + 100.0) if m >= 0 else -m / (-m + 100.0)


def devig(h, d, a):
    q = [amer_to_p(h), amer_to_p(d), amer_to_p(a)]
    s = sum(q)
    return q[0] / s, q[1] / s, q[2] / s          # pH, pD, pA


def suffix(n):
    e = round(math.log10(n))
    return '1e%d' % e if 10 ** e == n else str(n)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sims', type=int, default=100000)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--fixtures', default='../data/wc2026_fixtures.json')
    ap.add_argument('--out-dir', default='../data/simulations')
    args = ap.parse_args()
    N, suf = args.sims, suffix(args.sims)
    os.makedirs(args.out_dir, exist_ok=True)

    fix = json.load(open(args.fixtures, encoding='utf-8'))
    grp = [m for m in fix['matches'] if not (m.get('stage') or {}).get('knockout')]
    grp.sort(key=lambda m: (m.get('date') or '', m['id']))

    # Current goal difference per team (finished group games) — static tiebreaker.
    gd = collections.Counter()
    for m in grp:
        if m['status']['completed']:
            hs, as_ = m['home']['score'], m['away']['score']
            gd[m['home']['abbreviation']] += hs - as_
            gd[m['away']['abbreviation']] += as_ - hs

    rng = np.random.default_rng(args.seed)
    future = [m for m in grp if not m['status']['completed']]
    U = rng.random((N, len(future)))
    out_arr = {}                                  # game id -> (N,) array of 'H'/'D'/'A'
    pts = collections.defaultdict(lambda: collections.defaultdict(lambda: np.zeros(N, np.int16)))
    fi = 0
    for m in grp:
        gl, h, a = m.get('group'), m['home']['abbreviation'], m['away']['abbreviation']
        if m['status']['completed']:
            hs, as_ = m['home']['score'], m['away']['score']
            o = 'H' if hs > as_ else ('A' if as_ > hs else 'D')
            arr = np.full(N, o)
            if o == 'H': pts[gl][h] += 3
            elif o == 'A': pts[gl][a] += 3
            else: pts[gl][h] += 1; pts[gl][a] += 1
        else:
            ml = m['odds']['moneyline']
            pH, pD, _ = devig(ml['home'], ml['draw'], ml['away'])
            u = U[:, fi]; fi += 1
            arr = np.where(u < pH, 'H', np.where(u < pH + pD, 'D', 'A'))
            pts[gl][h] += np.where(arr == 'H', 3, np.where(arr == 'D', 1, 0)).astype(np.int16)
            pts[gl][a] += np.where(arr == 'A', 3, np.where(arr == 'D', 1, 0)).astype(np.int16)
        out_arr[m['id']] = arr

    # ---- write the per-game outcomes ----
    so = os.path.join(args.out_dir, 'group_sim_outcomes_%s.csv' % suf)
    meta = [(m['id'], m.get('group'), m['home']['abbreviation'], m['away']['abbreviation'],
             int(m['status']['completed'])) for m in grp]
    cols = [out_arr[m['id']].tolist() for m in grp]      # lists index far faster than numpy scalars
    with open(so, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['sim', 'game_id', 'group', 'home', 'away', 'finished', 'outcome'])
        w.writerows((s, gid, gl, h, a, fin, col[s])
                    for s in range(N)
                    for (gid, gl, h, a, fin), col in zip(meta, cols))

    # ---- rank teams within each group (vectorised) ----
    dice = np.random.default_rng(args.seed + 1)
    groups = sorted(pts)
    ranked = {}    # group -> (teams, P[N,4] list, gd[4], ranks[N,4] list, order_names[N,4])
    for gl in groups:
        teams = sorted(pts[gl])
        P = np.stack([pts[gl][t] for t in teams], axis=1)            # N x 4 points
        G = np.array([gd[t] for t in teams])                         # 4 goal diffs
        D = dice.random((N, len(teams)))
        # rank by points desc, then GD desc, then dice (lexsort: last key = primary)
        order = np.lexsort((D, np.broadcast_to(-G, (N, 4)), -P), axis=1)   # N x 4 team-indices, best first
        ranks = np.empty((N, 4), int)
        np.put_along_axis(ranks, order, np.broadcast_to(np.arange(1, 5), (N, 4)), axis=1)
        names = np.array(teams)
        ranked[gl] = (teams, P.tolist(), G, ranks.tolist(), names[order])

    sr = os.path.join(args.out_dir, 'group_ranks_%s.csv' % suf)
    with open(sr, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['sim', 'group', 'team', 'points', 'current_gd', 'rank'])
        w.writerows((s, gl, teams[ti], P[s][ti], int(G[ti]), ranks[s][ti])
                    for s in range(N)
                    for gl in groups
                    for (teams, P, G, ranks, _) in [ranked[gl]]
                    for ti in range(len(teams)))

    # ---- modal full finish ----
    name_orders = [ranked[gl][4] for gl in groups]                   # each N x 4 of names
    sigs = collections.Counter(
        tuple(tuple(no[s]) for no in name_orders) for s in range(N))
    (modal, cnt) = sigs.most_common(1)[0]
    distinct = len(sigs)
    print('sims: %d (suffix %s)' % (N, suf))
    print('  outcomes -> %s' % so)
    print('  ranks    -> %s' % sr)
    print('  distinct full 48-team finishes: %d  (%.2f%% unique)' %
          (distinct, 100 * sum(1 for v in sigs.values() if v == 1) / N))
    print('  modal full finish frequency: %d / %d = %.5f%%' % (cnt, N, 100 * cnt / N))


if __name__ == '__main__':
    main()
