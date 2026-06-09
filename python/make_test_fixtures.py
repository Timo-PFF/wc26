#!/usr/bin/env python3
"""
Make a LOCAL DEV copy of the fixtures with some games marked finished.

Reads  ../data/wc2026_fixtures.json  (the real, all-scheduled file)
Writes ../data/wc2026_fixtures.dev.json

Marks:
  * the first few group-stage matches (FINAL_SCORES) with plain results, and
  * three Round-of-32 matches (KNOCKOUTS) with made-up countries, one of each
    knockout finish: a straight 90' win, a win after extra time, and a draw
    decided on penalties.

This lets you test the "finished match" UX (locked inputs, results, standings,
the points chart) — and knockout scoring — before any real game kicks off. Load
it via  ?fixtures=data/wc2026_fixtures.dev.json  (index.html honors that
override; the default stays the real file).
"""

import json

SRC = "../data/wc2026_fixtures.json"
OUT = "../data/wc2026_fixtures.dev.json"

# (home goals, away goals) for the first len(FINAL_SCORES) GROUP matches, in file order.
FINAL_SCORES = [
    (2, 2),   # game 1 — a draw
    (2, 0),   # game 2 — home win
    (0, 0),   # game 3 — a draw
]

# Three Round-of-32 games with made-up teams — one of each knockout finish.
# decided: "regulation" | "extra_time" | "penalties".  hso/aso = shootout tally.
KNOCKOUTS = [
    {"home": ("Brazil", "BRA"), "away": ("Ghana", "GHA"),
     "hg": 2, "ag": 0, "decided": "regulation"},                     # straight win after 90'
    {"home": ("Spain", "ESP"), "away": ("Japan", "JPN"),
     "hg": 2, "ag": 1, "decided": "extra_time"},                     # win after extra time
    {"home": ("France", "FRA"), "away": ("England", "ENG"),
     "hg": 1, "ag": 1, "hso": 4, "aso": 3, "decided": "penalties"},  # draw, decided on penalties
]

# ESPN status by how the game was decided (see the 2022 WC scoreboard API).
STATUS = {
    "regulation": ("STATUS_FULL_TIME", "FT"),
    "extra_time": ("STATUS_FINAL_AET", "AET"),
    "penalties":  ("STATUS_FINAL_PEN", "FT-Pens"),
}


def make_team(name, abbr):
    return {
        "id": None, "displayName": name, "shortDisplayName": name, "name": name,
        "abbreviation": abbr,
        "logo": "https://a.espncdn.com/i/teamlogos/countries/500/" + abbr.lower() + ".png",
        "score": None, "shootout": None, "winner": False,
    }


def apply_result(m, hg, ag, decided="regulation", hso=None, aso=None):
    name, detail = STATUS[decided]
    m["status"] = {"name": name, "state": "post", "completed": True,
                   "detail": detail, "shortDetail": detail}
    m["home"]["score"], m["away"]["score"] = hg, ag
    m["home"]["shootout"], m["away"]["shootout"] = hso, aso
    if decided == "penalties":                      # 120' is a draw; shootout decides
        home_wins = hso > aso
        m["home"]["winner"], m["away"]["winner"] = home_wins, not home_wins
        m["winner"] = "home" if home_wins else "away"
    else:
        m["home"]["winner"], m["away"]["winner"] = hg > ag, ag > hg
        m["winner"] = "home" if hg > ag else ("away" if ag > hg else "draw")
    m["decidedBy"] = decided


def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    data["source"] = data.get("source", "") + " [DEV: group + knockout test results]"
    matches = data.get("matches", [])

    print(f"Group games ({len(FINAL_SCORES)}):")
    for i, (hg, ag) in enumerate(FINAL_SCORES):
        if i >= len(matches):
            break
        apply_result(matches[i], hg, ag, "regulation")
        m = matches[i]
        print(f"  {m['id']}  {m['home']['displayName']} {hg}–{ag} {m['away']['displayName']}")

    r32 = [m for m in matches if (m.get("stage") or {}).get("slug") == "round-of-32"]
    print(f"\nRound-of-32 games ({min(len(KNOCKOUTS), len(r32))}):")
    for ko, m in zip(KNOCKOUTS, r32):
        m["home"] = make_team(*ko["home"])
        m["away"] = make_team(*ko["away"])
        m["shortName"] = ko["away"][1] + " @ " + ko["home"][1]
        apply_result(m, ko["hg"], ko["ag"], ko["decided"], ko.get("hso"), ko.get("aso"))
        extra = f" (pens {ko['hso']}–{ko['aso']})" if ko["decided"] == "penalties" else \
            (" (AET)" if ko["decided"] == "extra_time" else "")
        print(f"  {m['id']}  {ko['home'][0]} {ko['hg']}–{ko['ag']} {ko['away'][0]}{extra}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
