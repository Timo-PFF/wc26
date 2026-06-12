#!/usr/bin/env python3
"""
Calibrate the odds->scoreline model on the historical training CSV and back-test
the optimal-pick strategy, then save the two fitted globals (rho, theta) to JSON.

Splits the data into train/test (random, seeded) so the back-test is honest: the
model is calibrated on the train split and its picks are scored on the held-out
test split, against three baselines (most-likely score, always 1-1, favourite 1-0).

Usage:
    python build_model.py
    python build_model.py --train ../data/training_odds.csv --out ../data/model_params.json
    python build_model.py --rho-sample 2000 --test-frac 0.25
"""

import argparse

import numpy as np

from model.model import ScoreModel
from model.calibrate import load_training, fit_theta, fit_rho, fit_threshold, backtest


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--train", default="../data/training_odds.csv")
    ap.add_argument("--out", default="../data/model_params.json")
    ap.add_argument("--test-frac", type=float, default=0.25,
                    help="fraction held out for the back-test")
    ap.add_argument("--rho-sample", type=int, default=2000,
                    help="games to subsample for the rho MLE (speed); 0 = all")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rows = load_training(args.train, regulation_only=True)
    print(f"Loaded {len(rows)} regulation games with complete odds.")
    if not rows:
        print("No usable rows — has the fetch finished?")
        return

    rng = np.random.default_rng(args.seed)
    perm = rng.permutation(len(rows))
    n_test = int(len(rows) * args.test_frac)
    test = [rows[i] for i in perm[:n_test]]
    train = [rows[i] for i in perm[n_test:]]
    print(f"Train: {len(train)}  Test: {len(test)}")

    theta = fit_theta(train)
    print(f"theta (mean goals / mean implied total) = {theta:.4f}")
    rho = fit_rho(train, theta, sample=(args.rho_sample or None), seed=args.seed)
    print(f"rho (Dixon-Coles, MLE)                  = {rho:.4f}")
    fav_threshold = fit_threshold(train)
    print(f"fav_threshold (implied-mean 1-0/2-1 cut) = {fav_threshold:.2f}")

    model = ScoreModel(rho=rho, theta=theta, fav_threshold=fav_threshold)
    model.save(args.out)
    print(f"Saved model params -> {args.out}")

    eval_rows = test if test else train
    means, n = backtest(model, eval_rows)
    label = "held-out test" if test else "train (no holdout)"
    print(f"\nBack-test mean pool points/game on {n} {label} games:")
    for k in ("model", "fav_by_1", "fav_1_0", "most_likely", "always_1_1"):
        print(f"  {k:12s}: {means[k]:.4f}")
    baselines = max(means["most_likely"], means["always_1_1"], means["fav_1_0"])
    print(f"  model    edge over best simple baseline: {means['model'] - baselines:+.4f} pts/game")
    print(f"  fav_by_1 edge over best simple baseline: {means['fav_by_1'] - baselines:+.4f} pts/game")


if __name__ == "__main__":
    main()
