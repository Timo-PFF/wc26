#!/usr/bin/env python3
"""
Make a LOCAL DEV copy of the fixtures with the WHOLE knockout bracket played out.

Reads  ../data/wc2026_fixtures.json        (the real, all-scheduled file)
Writes ../data/wc2026_fixtures.full-ko.dev.json

Unlike make_test_fixtures.py (which only finishes a few games), this fills every
knockout match: 32 real teams seeded into the Round of 32, then winners are
propagated through R16 → QF → SF → Final + 3rd place using the same feeder links
the bracket tab reads ("Round of 32 3 Winner", "Semifinal 1 Loser", …). Finishes
cycle through regulation / extra time / penalties so the bracket tab shows every
result type (a.e.t., pens) and both home- and away-side winners.

Group games are left scheduled — this file is purely for exercising the Knockout
tab. Load it via  ?fixtures=data/wc2026_fixtures.full-ko.dev.json .
"""

import json
import re

import make_test_fixtures as mtf   # reuse make_team() / apply_result() / STATUS

SRC = "../data/wc2026_fixtures.json"
OUT = "../data/wc2026_fixtures.full-ko.dev.json"

# 32 teams (name, ESPN abbreviation) seeded into the Round of 32 in match-id
# order: game j gets TEAMS[2j] (home) vs TEAMS[2j+1] (away).
TEAMS = [
    ("Argentina", "ARG"), ("Brazil", "BRA"), ("France", "FRA"), ("England", "ENG"),
    ("Spain", "ESP"), ("Germany", "GER"), ("Portugal", "POR"), ("Netherlands", "NED"),
    ("Belgium", "BEL"), ("Croatia", "CRO"), ("Uruguay", "URU"), ("Colombia", "COL"),
    ("Mexico", "MEX"), ("United States", "USA"), ("Japan", "JPN"), ("South Korea", "KOR"),
    ("Senegal", "SEN"), ("Morocco", "MAR"), ("Switzerland", "SUI"), ("Ecuador", "ECU"),
    ("Australia", "AUS"), ("Canada", "CAN"), ("Norway", "NOR"), ("Egypt", "EGY"),
    ("Iran", "IRN"), ("Qatar", "QAT"), ("Saudi Arabia", "KSA"), ("Tunisia", "TUN"),
    ("Sweden", "SWE"), ("Scotland", "SCO"), ("Paraguay", "PAR"), ("Panama", "PAN"),
]

# Result pattern cycled across every knockout game (home goals, away goals,
# how decided, home shootout, away shootout). Mixes finish types and which side
# advances; penalty rows are 1–1 with the shootout deciding.
PATTERN = [
    (2, 1, "regulation", None, None),   # home win
    (0, 1, "regulation", None, None),   # away win
    (1, 1, "penalties", 4, 2),          # home win on penalties
    (2, 1, "extra_time", None, None),   # home win after extra time
    (1, 2, "regulation", None, None),   # away win
    (3, 1, "regulation", None, None),   # home win
    (1, 1, "penalties", 3, 5),          # away win on penalties
    (1, 2, "extra_time", None, None),   # away win after extra time
]

FEEDER_SLUG = {
    "Round of 32": "round-of-32", "Round of 16": "round-of-16",
    "Quarterfinal": "quarterfinals", "Semifinal": "semifinals",
}
FEEDER_RE = re.compile(r"^(Round of 32|Round of 16|Quarterfinal|Semifinal)s? (\d+) (Winner|Loser)$")

# Dependent rounds, in an order where every feeder is already played.
DEPENDENT_ROUNDS = ["round-of-16", "quarterfinals", "semifinals", "3rd-place-match", "final"]


def winner_team(m):
    return m["home"] if m["winner"] == "home" else m["away"]


def loser_team(m):
    return m["away"] if m["winner"] == "home" else m["home"]


def place(team):
    """A copy of a team for the next round, with its result fields reset."""
    t = dict(team)
    t["score"], t["shootout"], t["winner"] = None, None, False
    return t


def short_name(m):
    return m["away"]["abbreviation"] + " @ " + m["home"]["abbreviation"]


def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    data["source"] = data.get("source", "") + " [DEV: full knockout bracket]"
    matches = data.get("matches", [])

    # Knockout matches grouped by round, each sorted by id (= the 1..n numbering
    # the feeder placeholders reference).
    rounds = {}
    for m in matches:
        st = m.get("stage") or {}
        if st.get("knockout"):
            rounds.setdefault(st["slug"], []).append(m)
    for lst in rounds.values():
        lst.sort(key=lambda m: int(m["id"]))
    idx_of = {(slug, i): m for slug, lst in rounds.items() for i, m in enumerate(lst, 1)}

    counter = {"n": 0}

    def play(m):
        hg, ag, decided, hso, aso = PATTERN[counter["n"] % len(PATTERN)]
        counter["n"] += 1
        mtf.apply_result(m, hg, ag, decided, hso, aso)

    def resolve_side(side):
        """The team that fills this placeholder slot (winner/loser of a feeder)."""
        mo = FEEDER_RE.match((side or {}).get("displayName", ""))
        slug, index, role = FEEDER_SLUG[mo.group(1)], int(mo.group(2)), mo.group(3)
        feeder = idx_of[(slug, index)]
        return place(winner_team(feeder) if role == "Winner" else loser_team(feeder))

    # Round of 32: seed real teams, then play.
    r32 = rounds.get("round-of-32", [])
    for j, m in enumerate(r32):
        m["home"], m["away"] = mtf.make_team(*TEAMS[2 * j]), mtf.make_team(*TEAMS[2 * j + 1])
        m["shortName"], m["name"] = short_name(m), TEAMS[2 * j][0] + " vs " + TEAMS[2 * j + 1][0]
        play(m)

    # Later rounds: resolve both sides from their feeders, then play.
    for slug in DEPENDENT_ROUNDS:
        for m in rounds.get(slug, []):
            m["home"], m["away"] = resolve_side(m["home"]), resolve_side(m["away"])
            m["shortName"] = short_name(m)
            m["name"] = m["home"]["displayName"] + " vs " + m["away"]["displayName"]
            play(m)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Summary, in bracket order.
    print(f"Wrote {OUT}\n")
    for slug in ["round-of-32"] + DEPENDENT_ROUNDS:
        for m in rounds.get(slug, []):
            h, a = m["home"], m["away"]
            tag = {"penalties": f" (pens {h['shootout']}–{a['shootout']})",
                   "extra_time": " (AET)"}.get(m["decidedBy"], "")
            print(f"  {slug:16} {h['abbreviation']} {h['score']}–{a['score']} {a['abbreviation']}{tag}")


if __name__ == "__main__":
    main()
