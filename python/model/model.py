"""High-level odds->scoreline model: ties de-vig + Dixon-Coles + the optimiser
behind one object holding the two calibrated globals (rho, theta)."""

import json
from dataclasses import dataclass, asdict

from .odds import devig_1x2, devig_two_way
from .dixon_coles import solve_lambdas, score_matrix, implied_total_mean, MAX_GOALS
from .scoring import best_pick, fav_by_1_pick, PICK_MAX


@dataclass
class ScoreModel:
    rho: float = -0.10        # Dixon-Coles low-score correction (calibrated)
    theta: float = 1.0        # O/U-line -> mean-goals scaler (calibrated)
    fav_threshold: float = 2.65  # implied-mean cutoff for the fav-by-1 strategy (1-0 vs 2-1)
    total_weight: float = 0.5
    max_goals: int = MAX_GOALS
    pick_max: int = PICK_MAX

    def fav_by_1(self, probs, over_under, p_over=None):
        """The favourite-by-one-goal pick for one game (uses fav_threshold)."""
        imean = implied_total_mean(over_under, p_over) if p_over is not None else over_under
        return fav_by_1_pick(probs.home >= probs.away, imean, self.fav_threshold)

    def lambdas(self, probs, over_under, p_over=None):
        """The fitted (lambda_home, lambda_away) goal rates for one game."""
        return solve_lambdas(probs, total_line=over_under, p_over=p_over,
                             rho=self.rho, total_weight=self.total_weight,
                             theta=self.theta, max_goals=self.max_goals)

    def predict_from_probs(self, probs, over_under, p_over=None):
        """Score-probability matrix from already de-vigged MatchProbs (+ optional
        de-vigged P(over) so the total anchor reflects the over/under price)."""
        lam_h, lam_a = self.lambdas(probs, over_under, p_over)
        return score_matrix(lam_h, lam_a, self.rho, self.max_goals)

    def predict_matrix(self, home_ml, draw_ml, away_ml, over_under,
                       over_ml=None, under_ml=None):
        """Score-probability matrix for one game, or None if the line is incomplete."""
        probs = devig_1x2(home_ml, draw_ml, away_ml)
        if probs is None:
            return None
        ou = devig_two_way(over_ml, under_ml)
        p_over = ou[0] if ou else None
        return self.predict_from_probs(probs, over_under, p_over)

    def optimal_pick(self, home_ml, draw_ml, away_ml, over_under):
        """(pick, expected_points, most_likely_score) or None."""
        m = self.predict_matrix(home_ml, draw_ml, away_ml, over_under)
        if m is None:
            return None
        return best_pick(m, self.pick_max)

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls(**json.load(f))
