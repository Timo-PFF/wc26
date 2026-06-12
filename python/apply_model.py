#!/usr/bin/env python3
"""
Apply the calibrated odds->scoreline model to the WC2026 odds snapshot and emit,
for every game with a usable line, the score that maximises expected pool points
("the optimal player's pick").

Output columns:
  event_id, date, stage, knockout, state, home, away, home_score, away_score,
  p_home, p_draw, p_away,                  # model (=market) outcome probabilities
  ml_home, ml_away,                        # single most-likely scoreline
  pick_home, pick_away,                    # expected-points-maximising pick
  pen_winner,                              # knockout only: higher-win-prob side
  exp_points,                              # model's expected points for the pick
  actual_points                            # filled once the game is finished

Knockout note: the score model predicts the regulation-style result the moneyline
prices; `pen_winner` is a simple best-guess (the side more likely to win) for the
pool's separate penalty-winner pick. Refine later if needed.

Usage:
    python apply_model.py
    python apply_model.py --params ../data/model_params.json --odds ../data/wc2026_odds.csv
"""

import argparse
import csv

from model.model import ScoreModel
from model.odds import devig_1x2, devig_two_way
from model.dixon_coles import implied_total_mean
from model.scoring import points, best_pick, fav_by_1_pick
from model.knockout import knockout_outcomes, best_ko_pick, ko_points

OUT_COLUMNS = [
    "event_id", "date", "stage", "knockout", "state", "home", "away",
    "home_score", "away_score",
    "p_home", "p_draw", "p_away", "over_under", "implied_mean",
    "ml_home", "ml_away",
    "pick_home", "pick_away", "pen_winner", "exp_points", "actual_points",
    "fav1_home", "fav1_away", "fav1_actual_points",
]


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
    ap.add_argument("--out", default="../data/wc2026_optimal_picks.csv")
    args = ap.parse_args()

    model = ScoreModel.load(args.params)
    print(f"Model: rho={model.rho:.4f} theta={model.theta:.4f}")

    out_rows, skipped, scored, total_pts = [], 0, 0, 0.0
    with open(args.odds, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            probs = devig_1x2(_f(r["home_ml"]), _f(r["draw_ml"]), _f(r["away_ml"]))
            ou = _f(r["over_under"])
            if probs is None or ou is None:
                skipped += 1
                continue
            two_way = devig_two_way(_f(r.get("over_odds")), _f(r.get("under_odds")))
            p_over = two_way[0] if two_way else None
            # Market-implied mean total goals (folds in the O/U price when present).
            imean = implied_total_mean(ou, p_over) if p_over is not None else ou
            is_ko = r["knockout"] == "True"

            if is_ko:
                # Knockout: optimise against the post-ET result + the KO scoring rule.
                lam_h, lam_a = model.lambdas(probs, ou, p_over)
                outcomes = knockout_outcomes(lam_h, lam_a, model.rho)
                (gh, ga, pen_pick), ev, ml = best_ko_pick(outcomes, model.pick_max)
                pick = (gh, ga)
                pen = r["home"] if pen_pick == "home" else r["away"]
            else:
                m = model.predict_from_probs(probs, ou, p_over)
                pick, ev, ml = best_pick(m, model.pick_max)
                pen = ""
            # The simple favourite-by-one strategy (calibrated implied-mean cutoff).
            fav1 = fav_by_1_pick(probs.home >= probs.away, imean, model.fav_threshold)

            row = {
                "event_id": r["event_id"], "date": r["date"], "stage": r["stage"],
                "knockout": r["knockout"], "state": r["state"],
                "home": r["home"], "away": r["away"],
                "home_score": r.get("home_score", ""), "away_score": r.get("away_score", ""),
                "p_home": round(probs.home, 4), "p_draw": round(probs.draw, 4),
                "p_away": round(probs.away, 4),
                "over_under": ou, "implied_mean": round(imean, 3),
                "ml_home": ml[0], "ml_away": ml[1],
                "pick_home": pick[0], "pick_away": pick[1],
                "pen_winner": pen,
                "exp_points": round(ev, 4), "actual_points": "",
                "fav1_home": fav1[0], "fav1_away": fav1[1], "fav1_actual_points": "",
            }
            # If the game is already finished, score both picks for free validation.
            hs, as_ = _f(r.get("home_score")), _f(r.get("away_score"))
            if r["state"] == "post" and hs is not None and as_ is not None:
                actual = (int(hs), int(as_))
                if is_ko:
                    # Build the actual knockout outcome: post-ET score, whether it
                    # went to penalties, and the advancer. The advancer is the
                    # `winner` column (needed for shootouts), falling back to the
                    # score for decisive games when winner is absent.
                    pens = r.get("decided_by") == "penalties"
                    adv = r.get("winner") or None
                    if not adv and not pens:
                        adv = "home" if actual[0] > actual[1] else "away"
                    if adv:
                        ko_actual = (actual[0], actual[1], pens, adv)
                        pen_side = "home" if pen == r["home"] else "away"
                        fav1_side = "home" if fav1[0] > fav1[1] else "away"
                        row["actual_points"] = ko_points((pick[0], pick[1], pen_side), ko_actual)
                        row["fav1_actual_points"] = ko_points((fav1[0], fav1[1], fav1_side), ko_actual)
                        total_pts += row["actual_points"]
                        scored += 1
                else:
                    row["actual_points"] = points(pick, actual)
                    row["fav1_actual_points"] = points(fav1, actual)
                    total_pts += row["actual_points"]
                    scored += 1
            out_rows.append(row)

    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
        w.writeheader()
        w.writerows(out_rows)

    print(f"Wrote {len(out_rows)} pick(s) -> {args.out} ({skipped} game(s) had no usable line).")
    if scored:
        print(f"Already-finished games: {scored}, optimal-pick points = {total_pts} "
              f"({total_pts / scored:.2f}/game).")


if __name__ == "__main__":
    main()
