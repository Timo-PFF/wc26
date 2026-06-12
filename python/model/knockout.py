"""Knockout-stage handling: convert the 90-minute score model into the result the
pool actually scores (post-extra-time score + who advances), and find the pick
that maximises expected knockout points.

Why this is separate from group games:
  - The 3-way moneyline prices the 90' result, so the model's score matrix is a
    90' distribution. But a knockout pick is scored against the post-ET score
    (a draw there means penalties), with a different, richer rule (KO_SCORING).
  - A 90' draw is resolved in extra time (modelled as ~1/3 of a match's extra
    minutes) or, failing that, a shootout — so the *scored* draw probability is
    strictly lower than the 90' draw probability.

KO_SCORING and the point logic mirror scorePick() in scoring.js exactly.
"""

import numpy as np
from scipy.stats import poisson

from .dixon_coles import score_matrix, MAX_GOALS
from .scoring import PICK_MAX

# Knockout point values (must match KO_SCORING in scoring.js).
KO = {
    "exact": 4, "goalDifference": 3, "winner": 2, "shootoutCalled": 1,
    "drawBase": 2, "drawExactBonus": 1, "drawPenBonus": 1, "penWinnerDecisive": 1,
}

ET_FRACTION = 1.0 / 3.0   # extra time is 30' vs the 90' match
MAX_ET = 6                # extra-time goals per side to enumerate (P(>6) ~ 0)
PEN_HOME_PROB = 0.5       # shootout ~ coin flip (calibratable; favourite tiebreak in picks)


def ko_points(guess, actual):
    """Pool knockout points for `guess` against an `actual` outcome.

    guess  = (gh, ga, pen_pick)   pen_pick in {'home','away'} — the shootout call
             (explicit for a draw guess; for a winner guess it is the picked winner)
    actual = (ah, aa, pens, advancer)   post-ET score, whether it went to pens,
             and which side advanced ('home'/'away').
    """
    gh, ga, pen_pick = guess
    ah, aa, pens, advancer = actual
    exact = (gh == ah and ga == aa)

    if gh != ga:                                   # (a) picked an outright winner
        pred = "home" if gh > ga else "away"
        if pens:
            return KO["shootoutCalled"] if pred == advancer else 0
        if pred != advancer:
            return 0
        if exact:
            return KO["exact"]
        if (gh - ga) == (ah - aa):
            return KO["goalDifference"]
        return KO["winner"]

    # (b) picked a draw + a penalty winner
    if not pens:
        return KO["penWinnerDecisive"] if pen_pick == advancer else 0
    pts = KO["drawBase"]
    if exact:
        pts += KO["drawExactBonus"]
    if pen_pick == advancer:
        pts += KO["drawPenBonus"]
    return pts


def knockout_outcomes(lam_h, lam_a, rho, pen_home_prob=PEN_HOME_PROB,
                      max_goals=MAX_GOALS, et_fraction=ET_FRACTION, max_et=MAX_ET):
    """Distribution over scored knockout outcomes as a list of
    (prob, ah, aa, pens, advancer) tuples.

    Decisive 90' games pass through unchanged; 90' draws get extra-time goals
    (independent Poisson at `et_fraction` of the goal rate); still-level games go
    to penalties, splitting the advancer by `pen_home_prob`."""
    m90 = score_matrix(lam_h, lam_a, rho, max_goals)
    n = m90.shape[0]
    et_h = poisson.pmf(np.arange(max_et + 1), lam_h * et_fraction)
    et_a = poisson.pmf(np.arange(max_et + 1), lam_a * et_fraction)

    out = []
    for h in range(n):
        for a in range(n):
            p = m90[h, a]
            if p <= 0:
                continue
            if h > a:
                out.append((p, h, a, False, "home"))
            elif a > h:
                out.append((p, h, a, False, "away"))
            else:                                  # 90' draw -> extra time
                for eh in range(max_et + 1):
                    for ea in range(max_et + 1):
                        pe = p * et_h[eh] * et_a[ea]
                        if pe <= 0:
                            continue
                        fh, fa = h + eh, a + ea
                        if eh > ea:
                            out.append((pe, fh, fa, False, "home"))
                        elif ea > eh:
                            out.append((pe, fh, fa, False, "away"))
                        else:                      # still level -> shootout
                            out.append((pe * pen_home_prob, fh, fa, True, "home"))
                            out.append((pe * (1 - pen_home_prob), fh, fa, True, "away"))
    return out


def _candidate_guesses(pick_max):
    """Outright-winner guesses (pen pick = the picked winner) + draw guesses with
    each shootout call."""
    cands = []
    for gh in range(pick_max + 1):
        for ga in range(pick_max + 1):
            if gh != ga:
                cands.append((gh, ga, "home" if gh > ga else "away"))
            else:
                cands.append((gh, ga, "home"))
                cands.append((gh, ga, "away"))
    return cands


def best_ko_pick(outcomes, pick_max=PICK_MAX):
    """Return (guess, expected_points, most_likely_score) where guess is
    (gh, ga, pen_pick). `most_likely_score` is the modal post-ET (ah, aa)."""
    best, best_ev = None, -1.0
    for guess in _candidate_guesses(pick_max):
        ev = 0.0
        for (p, ah, aa, pens, adv) in outcomes:
            if p > 0:
                ev += p * ko_points(guess, (ah, aa, pens, adv))
        if ev > best_ev:
            best_ev, best = ev, guess

    # Modal final score (aggregate probability over post-ET scorelines).
    agg = {}
    for (p, ah, aa, _pens, _adv) in outcomes:
        agg[(ah, aa)] = agg.get((ah, aa), 0.0) + p
    ml = max(agg, key=agg.get)
    return best, best_ev, ml
