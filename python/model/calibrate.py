"""Calibrate the two global parameters (rho, theta) on historical (odds -> score)
data, and backtest the optimal-pick strategy against simple baselines.

theta is closed-form (the ratio of realised mean total goals to the mean O/U
line, so the total anchor is unbiased). rho is then fit by maximum likelihood of
the observed scorelines. Both are fit on regulation-time games with a complete
3-way line + total — knockout games settled in extra time / penalties are
excluded because their stored score isn't the 90' result the moneyline priced.
"""

import csv
import math

import numpy as np
from scipy.optimize import minimize_scalar

from .odds import devig_1x2, devig_two_way
from .dixon_coles import solve_lambdas, score_matrix, implied_total_mean
from .scoring import points, best_pick, fav_by_1_pick


def load_training(path, regulation_only=True):
    """Read the training CSV into a list of dicts with parsed numbers. Keeps only
    rows with a complete 3-way moneyline, an over/under, and a final score."""
    rows = []
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            try:
                hs, as_ = int(r["home_score"]), int(r["away_score"])
                home_ml, draw_ml, away_ml = float(r["home_ml"]), float(r["draw_ml"]), float(r["away_ml"])
                ou = float(r["over_under"])
            except (ValueError, KeyError, TypeError):
                continue
            if regulation_only and r.get("decided_by") not in (None, "", "regulation"):
                continue
            probs = devig_1x2(home_ml, draw_ml, away_ml)
            if probs is None:
                continue
            # De-vigged P(over) from the two-way O/U price, when present.
            two_way = devig_two_way(r.get("over_odds") or None, r.get("under_odds") or None)
            p_over = two_way[0] if two_way else None
            imean = implied_total_mean(ou, p_over) if p_over is not None else ou
            rows.append({
                "league": r.get("league"), "season": r.get("season"),
                "home_score": hs, "away_score": as_, "over_under": ou,
                "p_over": p_over, "imean": imean,
                "home_fav": probs.home >= probs.away, "probs": probs,
            })
    return rows


def fit_theta(rows):
    """Closed-form: realised mean total goals / mean market-implied mean total.

    The implied mean folds in the over/under price (when present); games with no
    price fall back to the raw line, matching how the model anchors the total."""
    mean_goals = np.mean([r["home_score"] + r["away_score"] for r in rows])
    implied = [implied_total_mean(r["over_under"], r["p_over"]) if r["p_over"] is not None
               else r["over_under"] for r in rows]
    return float(mean_goals / np.mean(implied))


def _neg_loglik(rho, rows, theta, max_goals=10):
    """Negative log-likelihood of the observed scorelines under (rho, theta)."""
    ll = 0.0
    for r in rows:
        lam_h, lam_a = solve_lambdas(r["probs"], total_line=r["over_under"],
                                     p_over=r["p_over"], rho=rho, theta=theta,
                                     max_goals=max_goals)
        m = score_matrix(lam_h, lam_a, rho, max_goals)
        h, a = min(r["home_score"], max_goals), min(r["away_score"], max_goals)
        ll += math.log(max(m[h, a], 1e-12))
    return -ll


def fit_rho(rows, theta, bounds=(-0.2, 0.0), sample=None, seed=0):
    """1-D MLE for rho with theta fixed. Optionally fit on a random subsample
    (the per-game lambda solve makes the full set slow); returns the rho."""
    fit_rows = rows
    if sample and sample < len(rows):
        rng = np.random.default_rng(seed)
        idx = rng.choice(len(rows), size=sample, replace=False)
        fit_rows = [rows[i] for i in idx]
    res = minimize_scalar(_neg_loglik, args=(fit_rows, theta), bounds=bounds,
                          method="bounded", options={"xatol": 1e-3})
    return float(res.x)


def fit_threshold(rows, lo=1.5, hi=4.0, step=0.05):
    """Grid-search the implied-mean cutoff that maximises the fav-by-1 strategy's
    mean pool points (below -> 1-0, at/above -> 2-1; mirrored for away favourites)."""
    grid = np.arange(lo, hi + 1e-9, step)
    best_T, best_pts = float(grid[0]), -1.0
    for T in grid:
        s = np.mean([points(fav_by_1_pick(r["home_fav"], r["imean"], T),
                            (r["home_score"], r["away_score"])) for r in rows])
        if s > best_pts:
            best_pts, best_T = s, float(T)
    return round(best_T, 2)   # grid is in 0.05 steps; avoid float-drift like 2.650000001


# ---- backtest -------------------------------------------------------------

def backtest(model, rows):
    """Score the model's optimal pick vs baselines over `rows`. Returns a dict of
    mean points per game for each strategy."""
    tot = {"model": 0.0, "most_likely": 0.0, "always_1_1": 0.0,
           "fav_1_0": 0.0, "fav_by_1": 0.0}
    n = 0
    for r in rows:
        m = model.predict_from_probs(r["probs"], r["over_under"], r["p_over"])
        actual = (min(r["home_score"], m.shape[0] - 1), min(r["away_score"], m.shape[1] - 1))
        pick, _, ml = best_pick(m, model.pick_max)
        fav_pick = (1, 0) if r["probs"].home >= r["probs"].away else (0, 1)
        fb1_pick = fav_by_1_pick(r["home_fav"], r["imean"], model.fav_threshold)
        tot["model"] += points(pick, actual)
        tot["most_likely"] += points(ml, actual)
        tot["always_1_1"] += points((1, 1), actual)
        tot["fav_1_0"] += points(fav_pick, actual)
        tot["fav_by_1"] += points(fb1_pick, actual)
        n += 1
    return {k: v / n for k, v in tot.items()}, n
