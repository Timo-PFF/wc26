"""Pool scoring + the expected-points-maximising scoreline.

Pool rule (matches scoring.js in the web app):
  - exact score                              -> EXACT (3)
  - right winner AND right goal difference   -> GOAL_DIFF (2)   [decided games only]
  - right outcome (incl. a correctly-called draw), wrong score -> OUTCOME (1)
  - wrong outcome                            -> 0

A predicted draw can only score 3 (exact) or 1 (right draw); the goal-difference
tier applies only to winner picks, mirroring the GD column in the app.
"""

import numpy as np

EXACT = 3
GOAL_DIFF = 2
OUTCOME = 1

# Candidate scorelines to consider when optimising. 0..MAX each side is plenty;
# the optimal pick is almost always a low scoreline.
PICK_MAX = 6


def points(pick, actual):
    """Pool points for predicting `pick`=(h,a) when the result was `actual`=(h,a)."""
    ph, pa = pick
    ah, aa = actual
    if ph == ah and pa == aa:
        return EXACT
    pick_sign = (ph > pa) - (ph < pa)      # 1 home, -1 away, 0 draw
    actual_sign = (ah > aa) - (ah < aa)
    if pick_sign != actual_sign:
        return 0                            # wrong outcome (incl. draw-vs-decided)
    # Right outcome. Winner picks can also hit the goal-difference tier.
    if pick_sign != 0 and (ph - pa) == (ah - aa):
        return GOAL_DIFF
    return OUTCOME


def expected_points(pick, matrix):
    """Expected pool points of `pick` over a score-probability matrix."""
    n = matrix.shape[0]
    # Vectorised: build the points matrix for this pick against every cell once.
    total = 0.0
    ph, pa = pick
    for ah in range(n):
        row = matrix[ah]
        for aa in range(n):
            p = row[aa]
            if p > 0:
                total += p * points((ph, pa), (ah, aa))
    return total


def best_pick(matrix, pick_max=PICK_MAX):
    """Return (pick, expected_points, most_likely_score) for a score matrix.

    `pick` maximises expected pool points; `most_likely_score` is the single
    highest-probability cell (often different — the optimiser trades exactness
    for safer GD/outcome points)."""
    best, best_ev = None, -1.0
    for ph in range(pick_max + 1):
        for pa in range(pick_max + 1):
            ev = expected_points((ph, pa), matrix)
            if ev > best_ev:
                best_ev, best = ev, (ph, pa)
    ml_idx = np.unravel_index(np.argmax(matrix), matrix.shape)
    return best, best_ev, (int(ml_idx[0]), int(ml_idx[1]))


def fav_by_1_pick(home_fav, implied_mean, threshold):
    """The 'favourite by one goal' strategy: always back the favourite to win by
    one, choosing the exact scoreline by the game's implied mean total — 2-1 (or
    1-2 away) at/above the calibrated `threshold`, else 1-0 (or 0-1 away).

    A near-optimal, trivially explainable alternative to the full score model
    under this scoring rule (the goal difference is what pays; the exact 1-goal
    scoreline barely matters)."""
    high = implied_mean >= threshold
    if home_fav:
        return (2, 1) if high else (1, 0)
    return (1, 2) if high else (0, 1)
