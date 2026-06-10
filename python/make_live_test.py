#!/usr/bin/env python3
"""
Make test data for the live-scores feature (the ?live= override).

The frontend's ?live=<path> override swaps the real ESPN call for a local file,
so these let you test the live overlay offline — no actual live game needed.

Produces:
  data/wc2026_fixtures.live.dev.json   fixtures with TWO games moved to the past
                                        so the app treats them as LIVE:
                                          - 760484  ALG-AUT     (group J)
                                          - 760486  R32 #1      (knockout)
  data/espn_live_a.dev.json   (a) the GROUP game in progress, 1-0
                                  → provisional "live" overlay + standings +Δ
  data/espn_live_b.dev.json   (b) the KNOCKOUT game FINAL on penalties (1-1, won
                                  4-3) while fixtures still say live → the app must
                                  PROMOTE it to final and score the penalty result
                                  officially (no +Δ; advances in the bracket)

Load (one scenario at a time against the same fixtures file):
  ?league=family&fixtures=data/wc2026_fixtures.live.dev.json&live=data/espn_live_a.dev.json
  ?league=family&fixtures=data/wc2026_fixtures.live.dev.json&live=data/espn_live_b.dev.json

Only the fields the client parser reads are populated (competitors' homeAway /
score / shootoutScore / winner, and competition.status.type), kept ESPN-shaped.
"""

import json

FIXTURES = "../data/wc2026_fixtures.json"
GROUP_ID = "760484"   # ALG-AUT, last group match
KO_ID = "760486"      # first Round-of-32 match
OLD_DATE, LIVE_DATE = "2026-06-28", "2026-06-09"   # both target games kick off Jun 28 → move to Jun 9


def competitor(side, team, score, shootout=None, winner=False):
    """One ESPN competitor entry (scores are strings, as the real API returns)."""
    c = {
        "id": team.get("id"), "homeAway": side, "winner": winner, "score": str(score),
        "team": {"id": team.get("id"), "abbreviation": team.get("abbreviation"),
                 "displayName": team.get("displayName")},
    }
    if shootout is not None:
        c["shootoutScore"] = str(shootout)
    return c


def event(m, hs, as_, name, state, completed, detail, hso=None, aso=None, h_win=False, a_win=False):
    return {
        "id": m["id"],
        "competitions": [{
            "id": m["id"],
            "status": {"type": {"name": name, "state": state, "completed": completed,
                                "detail": detail, "shortDetail": detail}},
            "competitors": [competitor("home", m["home"], hs, hso, h_win),
                            competitor("away", m["away"], as_, aso, a_win)],
        }],
    }


def write(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def main():
    with open(FIXTURES, encoding="utf-8") as f:
        fixtures = json.load(f)
    by_id = {m["id"]: m for m in fixtures["matches"]}
    grp, ko = by_id[GROUP_ID], by_id[KO_ID]

    # 1) Fixtures with both games moved to the past → LIVE per the app's clock.
    grp["date"] = grp["date"].replace(OLD_DATE, LIVE_DATE)
    ko["date"] = ko["date"].replace(OLD_DATE, LIVE_DATE)
    fixtures["source"] = fixtures.get("source", "") + " [DEV: 760484 + 760486 moved to Jun 9 to test live overlay]"
    write("../data/wc2026_fixtures.live.dev.json", fixtures)

    # 2a) Group game in progress, 1-0.
    write("../data/espn_live_a.dev.json",
          {"events": [event(grp, 1, 0, "STATUS_FIRST_HALF", "in", False, "1st Half")]})

    # 2b) Knockout game FINAL on penalties: 1-1 after 120', home wins shootout 4-3.
    write("../data/espn_live_b.dev.json",
          {"events": [event(ko, 1, 1, "STATUS_FINAL_PEN", "post", True, "FT-Pens",
                            hso=4, aso=3, h_win=True)]})

    print(f"(a) group   {grp['home'].get('abbreviation')}-{grp['away'].get('abbreviation')} ({GROUP_ID}) in-progress 1-0")
    print(f"(b) knockout {ko['home'].get('abbreviation')}-{ko['away'].get('abbreviation')} ({KO_ID}) FINAL 1-1, 4-3 pens (home advances)")
    print("Wrote ../data/wc2026_fixtures.live.dev.json, espn_live_a.dev.json, espn_live_b.dev.json")


if __name__ == "__main__":
    main()
