"""Convert bookmaker odds to clean (vig-free) probabilities.

The training/snapshot CSVs store American moneylines for the three soccer
outcomes (home / draw / away) plus an over/under total. A book's quoted prices
sum to more than 100% — the "overround" or vig. We strip it proportionally to
recover probabilities that sum to 1, which is what the score model consumes.
"""

from dataclasses import dataclass


def american_to_prob(ml):
    """Implied (vig-inclusive) probability from an American moneyline.

    +220 -> 100/320 = 0.3125 ; -150 -> 150/250 = 0.60 ; None -> None.
    """
    if ml is None:
        return None
    ml = float(ml)
    if ml >= 0:
        return 100.0 / (ml + 100.0)
    return -ml / (-ml + 100.0)


@dataclass
class MatchProbs:
    """Vig-free outcome probabilities for one match (sum to 1)."""
    home: float
    draw: float
    away: float
    overround: float  # the book's vig: raw implied probs summed (>1)


def devig_1x2(home_ml, draw_ml, away_ml):
    """De-vig a 3-way moneyline by proportional scaling. Returns MatchProbs,
    or None if any of the three prices is missing."""
    q = [american_to_prob(home_ml), american_to_prob(draw_ml), american_to_prob(away_ml)]
    if any(v is None for v in q):
        return None
    total = sum(q)
    return MatchProbs(home=q[0] / total, draw=q[1] / total,
                      away=q[2] / total, overround=total)


def devig_two_way(over_ml, under_ml):
    """De-vig a 2-way market (over/under) -> (p_over, p_under), or None."""
    qo, qu = american_to_prob(over_ml), american_to_prob(under_ml)
    if qo is None or qu is None:
        return None
    total = qo + qu
    return qo / total, qu / total
