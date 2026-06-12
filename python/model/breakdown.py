"""Per-game pick breakdown: for every candidate scoreline, the probability of
each scoring outcome plus the expected goal-difference error.

For a candidate pick the four probabilities partition all possible results and
sum to 1, mapping onto the pool's scoring tiers:
  p_exact   -> EXACT     (3 pts): result equals the pick
  p_gd      -> GOAL_DIFF (2 pts): right winner AND right goal difference, not exact
  p_outcome -> OUTCOME   (1 pt) : right outcome (incl. a called draw), lower tiers missed
  p_wrong   -> 0          : wrong outcome
exp_gd_error = E|pick_GD - actual_GD| over the score distribution.

Probabilities are taken over the FULL score matrix (which extends past 6 goals),
while the candidate picks themselves are capped at `pick_max` (the realistic set).
"""

import numpy as np

from .scoring import EXACT, GOAL_DIFF, OUTCOME, PICK_MAX


def game_breakdown(matrix, pick_max=PICK_MAX):
    """List of per-pick dicts for picks (0..pick_max)x(0..pick_max), each with
    p_exact / p_gd / p_outcome / p_wrong, exp_points and exp_gd_error."""
    n = matrix.shape[0]
    idx = np.arange(n)
    actual_gd = idx[:, None] - idx[None, :]      # actual home-away GD per cell
    actual_sign = np.sign(actual_gd)

    rows = []
    for ph in range(pick_max + 1):
        for pa in range(pick_max + 1):
            pgd = ph - pa
            psign = int(np.sign(pgd))
            p_exact = float(matrix[ph, pa]) if ph < n and pa < n else 0.0

            if psign == 0:                       # draw pick: no GD tier
                p_draw = float(matrix[actual_sign == 0].sum())
                p_gd = 0.0
                p_outcome = p_draw - p_exact     # called the draw, wrong score
                p_wrong = 1.0 - p_draw
            else:
                p_same_gd = float(matrix[actual_gd == pgd].sum())
                p_same_winner = float(matrix[actual_sign == psign].sum())
                p_gd = p_same_gd - p_exact       # same GD includes the exact cell
                p_outcome = p_same_winner - p_same_gd
                p_wrong = 1.0 - p_same_winner

            exp_gd_error = float((matrix * np.abs(pgd - actual_gd)).sum())
            exp_points = EXACT * p_exact + GOAL_DIFF * p_gd + OUTCOME * p_outcome
            rows.append({
                "pick_home": ph, "pick_away": pa,
                "p_exact": p_exact, "p_gd": p_gd,
                "p_outcome": p_outcome, "p_wrong": p_wrong,
                "exp_points": exp_points, "exp_gd_error": exp_gd_error,
            })
    return rows
