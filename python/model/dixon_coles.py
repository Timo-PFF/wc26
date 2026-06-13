"""Dixon-Coles score model: goal rates -> a joint distribution over scorelines.

Independent Poisson for home/away goals, with the Dixon-Coles low-score
correction `rho` that nudges the 0-0 / 1-0 / 0-1 / 1-1 cells so the model
reproduces football's real draw and low-scoring frequencies (plain independent
Poisson under-predicts draws).

The two per-match goal rates (lambda_home, lambda_away) are not observed — we
back them out from the market: solve for the pair whose model-implied 1X2
probabilities match the de-vigged book probabilities, with the over/under line
anchoring their sum.
"""

import math

import numpy as np
from scipy.optimize import least_squares, brentq
from scipy.stats import poisson

# Score grid cap. P(>=10 goals for one side) is negligible for soccer, and the
# tail beyond this contributes ~0 to any expected-points calculation.
MAX_GOALS = 10


def _tau(h, a, lam_h, lam_a, rho):
    """Dixon-Coles correction factor on the four low-score cells (else 1)."""
    if h == 0 and a == 0:
        return 1.0 - lam_h * lam_a * rho
    if h == 0 and a == 1:
        return 1.0 + lam_h * rho
    if h == 1 and a == 0:
        return 1.0 + lam_a * rho
    if h == 1 and a == 1:
        return 1.0 - rho
    return 1.0


def score_matrix(lam_h, lam_a, rho, max_goals=MAX_GOALS):
    """(max_goals+1) x (max_goals+1) matrix P[h, a] of scoreline probabilities."""
    h = poisson.pmf(np.arange(max_goals + 1), lam_h)
    a = poisson.pmf(np.arange(max_goals + 1), lam_a)
    m = np.outer(h, a)
    # Apply the low-score correction, then renormalise (tau + the truncated tail
    # both perturb the total slightly).
    for (i, j) in [(0, 0), (0, 1), (1, 0), (1, 1)]:
        m[i, j] *= _tau(i, j, lam_h, lam_a, rho)
    s = m.sum()
    if not np.isfinite(s) or s <= 0:
        # Degenerate (e.g. a goal rate so high the truncated grid underflows to 0,
        # which the solver can probe mid-iteration). Fall back to uniform so the
        # residuals stay finite rather than NaN-poisoning the optimisation.
        return np.full_like(m, 1.0 / m.size)
    return m / s


def outcome_probs(matrix):
    """(p_home_win, p_draw, p_away_win) from a score matrix."""
    home = np.tril(matrix, -1).sum()   # h > a
    away = np.triu(matrix, 1).sum()    # a > h
    draw = np.trace(matrix)            # h == a
    return home, draw, away


def implied_total_mean(total_line, p_over):
    """Market-implied mean total goals from the O/U line + the de-vigged P(over).

    Treats the total as Poisson and inverts P(total >= over_threshold) = p_over.
    Soccer lines are almost always .5 (no push), so the over threshold is
    floor(line)+1. This lets two games on the same 2.5 line imply different mean
    totals when their over/under prices differ.
    """
    k = math.floor(total_line) + 1                 # smallest total that is "over"
    p_over = min(max(p_over, 1e-3), 1 - 1e-3)
    # poisson.sf(k-1, lam) = P(N >= k); increasing in lam, so a clean bracket.
    return brentq(lambda lam: poisson.sf(k - 1, lam) - p_over, 1e-3, 20.0)


def target_total(total_line, p_over, theta):
    """The mean total to anchor lambda_home+lambda_away to. Uses the price-aware
    implied mean when an over price is available, else the raw line."""
    base = implied_total_mean(total_line, p_over) if p_over is not None else total_line
    return theta * base


def solve_lambdas(probs, total_line=None, p_over=None, rho=0.0, total_weight=0.5,
                  theta=1.0, max_goals=MAX_GOALS):
    """Find (lambda_home, lambda_away) whose DC model matches the market.

    `probs` is a MatchProbs (vig-free 1X2). We least-squares fit the model's
    home-win and away-win probabilities to the market, and — when an over/under
    line is given — also pull lambda_home+lambda_away toward the target mean total
    (`target_total`, which folds in the over/under price when present, scaled by
    `theta`). `total_weight` trades off how hard the total is enforced vs the 1X2
    shape.
    """
    p_home, p_away = probs.home, probs.away
    tgt_total = target_total(total_line, p_over, theta) if total_line is not None else None

    def residuals(x):
        lam_h, lam_a = np.exp(x)  # exp keeps rates positive
        m = score_matrix(lam_h, lam_a, rho, max_goals)
        mh, _, ma = outcome_probs(m)
        res = [mh - p_home, ma - p_away]
        if tgt_total is not None:
            res.append(total_weight * ((lam_h + lam_a) - tgt_total))
        return res

    # Initial guess: split a sensible total by the relative win probabilities.
    base_total = tgt_total if tgt_total else 2.6
    tilt = (p_home + 1e-6) / (p_home + p_away + 2e-6)
    guess = np.log([max(base_total * tilt, 0.2), max(base_total * (1 - tilt), 0.2)])
    # Bound the search to realistic goal rates (lambda in [0.02, 8]) so the solver
    # can't probe the underflow region of the truncated grid. log-space keeps the
    # rates positive; trf supports the bounds (lm does not).
    lo, hi = np.log(0.02), np.log(8.0)
    guess = np.clip(guess, lo, hi)
    sol = least_squares(residuals, guess, method="trf", bounds=([lo, lo], [hi, hi]))
    return tuple(np.exp(sol.x))
