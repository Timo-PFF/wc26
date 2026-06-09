#!/usr/bin/env python3
"""
Make a LOCAL DEV copy of the fixtures with final scores on the first few games.

Reads  ../data/wc2026_fixtures.json  (the real, all-scheduled file)
Writes ../data/wc2026_fixtures.dev.json  (same data, but the first N matches in
       chronological order are marked Full Time with the scores below)

This lets you test the "finished match" UX (locked inputs, the "Final: x–y" line,
and live standings/points) before any real game has kicked off. Load it by
opening the page with  ?fixtures=data/wc2026_fixtures.dev.json  — index.html
honors that query override (default stays the real file).

Edit FINAL_SCORES to taste. Each (home, away) is applied to the matches in the
order they appear in the file (which is sorted by kickoff, then id).
"""

import json

SRC = "../data/wc2026_fixtures.json"
OUT = "../data/wc2026_fixtures.dev.json"

# (home goals, away goals) for the first len(FINAL_SCORES) matches, in file order.
FINAL_SCORES = [
    (2, 2),   # game 1 — a draw
    (2, 0),   # game 2 — home win
    (0, 0),   # game 3 — a draw
]

# What ESPN puts on a completed match (see the 2022 WC scoreboard API).
FINISHED_STATUS = {
    "name": "STATUS_FULL_TIME",
    "state": "post",
    "completed": True,
    "detail": "FT",
    "shortDetail": "FT",
}


def apply_final(match, home_goals, away_goals):
    match["status"] = dict(FINISHED_STATUS)
    match["home"]["score"] = home_goals
    match["away"]["score"] = away_goals
    match["home"]["winner"] = home_goals > away_goals
    match["away"]["winner"] = away_goals > home_goals
    if home_goals > away_goals:
        match["winner"] = "home"
    elif away_goals > home_goals:
        match["winner"] = "away"
    else:
        match["winner"] = "draw"


def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    data["source"] = data.get("source", "") + " [DEV: first games scored]"
    matches = data.get("matches", [])

    print(f"Marking {len(FINAL_SCORES)} game(s) Full Time:")
    for i, (hg, ag) in enumerate(FINAL_SCORES):
        if i >= len(matches):
            break
        m = matches[i]
        apply_final(m, hg, ag)
        print(f"  {m['id']}  {m['home']['displayName']} {hg}–{ag} {m['away']['displayName']}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
