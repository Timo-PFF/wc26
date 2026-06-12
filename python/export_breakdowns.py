#!/usr/bin/env python3
"""
Write one per-game breakdown CSV for every WC2026 game with a usable line.

Each file holds one row per candidate scoreline (0-0 .. 6-6, 49 rows), sorted by
expected pool points (so the optimal pick is on top), with columns:

    pick_home, pick_away,
    p_exact, p_gd, p_outcome, p_wrong,   # probabilities of each scoring tier (sum to 1)
    exp_points,                          # 3*p_exact + 2*p_gd + 1*p_outcome
    exp_gd_error                         # E|pick_GD - actual_GD|

Files land in --out-dir, named "<date>_<HOME>-<AWAY>_<event_id>.csv".

Usage:
    python export_breakdowns.py
    python export_breakdowns.py --params ../data/model_params.json \
                                --odds ../data/wc2026_odds.csv \
                                --out-dir ../data/game_breakdowns
"""

import argparse
import csv
import os

from model.model import ScoreModel
from model.odds import devig_1x2, devig_two_way
from model.breakdown import game_breakdown

ROW_COLUMNS = [
    "pick_home", "pick_away", "p_exact", "p_gd", "p_outcome", "p_wrong",
    "exp_points", "exp_gd_error",
]
PICK_MAX = 6
ROUND = 5


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--params", default="../data/model_params.json")
    ap.add_argument("--odds", default="../data/wc2026_odds.csv")
    ap.add_argument("--out-dir", default="../data/game_breakdowns")
    args = ap.parse_args()

    model = ScoreModel.load(args.params)
    os.makedirs(args.out_dir, exist_ok=True)
    print(f"Model: rho={model.rho:.4f} theta={model.theta:.4f}")

    written, skipped = 0, 0
    with open(args.odds, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            probs = devig_1x2(_f(r["home_ml"]), _f(r["draw_ml"]), _f(r["away_ml"]))
            ou = _f(r["over_under"])
            if probs is None or ou is None:
                skipped += 1
                continue
            two_way = devig_two_way(_f(r.get("over_odds")), _f(r.get("under_odds")))
            p_over = two_way[0] if two_way else None
            matrix = model.predict_from_probs(probs, ou, p_over)

            rows = game_breakdown(matrix, pick_max=PICK_MAX)
            rows.sort(key=lambda x: x["exp_points"], reverse=True)

            name = f"{(r['date'] or '')[:10]}_{r['home']}-{r['away']}_{r['event_id']}.csv"
            path = os.path.join(args.out_dir, name)
            with open(path, "w", encoding="utf-8", newline="") as out:
                w = csv.DictWriter(out, fieldnames=ROW_COLUMNS)
                w.writeheader()
                for row in rows:
                    w.writerow({k: (round(v, ROUND) if isinstance(v, float) else v)
                                for k, v in row.items()})
            written += 1

    print(f"Wrote {written} per-game file(s) to {args.out_dir} "
          f"({skipped} game(s) had no usable line).")


if __name__ == "__main__":
    main()
