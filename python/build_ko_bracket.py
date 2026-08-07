#!/usr/bin/env python3
"""Derive knockout feeder connectivity for a COMPLETED tournament from its fixtures,
by tracing each match's advancing team into the next round. Works for any bracket
shape (WC round-of-32 or Euro round-of-16). Output mirrors the hand-built
wc2026_knockout_bracket.json: every match past the FIRST knockout round lists the two
feeder match ids whose winners (losers, for a 3rd-place game) meet in it — keyed by
id so the frontend's buildBracket() can fold it into the bracket tree.

NB: only works once the knockout games are played (needs real winners). For a LIVE
future tournament the linkage must be authored by hand from the official bracket.

Usage:
  py -3 build_ko_bracket.py --fixtures ../data/euro2024/euro2024_fixtures.json \
                            --out ../data/euro2024/euro2024_knockout_bracket.json
"""
import argparse
import json

# First-to-last; the first knockout round present is fed by GROUPS (no KO feeders).
ROUND_ORDER = ["round-of-32", "round-of-16", "quarterfinals", "semifinals", "3rd-place-match", "final"]


def team_key(side):
    return str((side or {}).get("id") or (side or {}).get("abbreviation") or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    fx = json.load(open(args.fixtures, encoding="utf-8"))
    ko = [m for m in fx["matches"] if (m.get("stage") or {}).get("knockout")]

    by_round = {}
    for m in ko:
        by_round.setdefault((m.get("stage") or {}).get("slug"), []).append(m)
    # rounds present, in bracket order, excluding the (separate) 3rd-place match
    present = [r for r in ROUND_ORDER if r in by_round and r != "3rd-place-match"]

    # advancing team per completed KO match (winner = ESPN's advancer, incl. shootouts)
    advancer = {}
    for m in ko:
        w = m.get("winner")
        if w in ("home", "away"):
            advancer[m["id"]] = team_key(m[w])

    out = []
    for i, rnd in enumerate(present):
        if i == 0:
            continue  # first KO round is fed by group standings, not KO matches
        prior = by_round[present[i - 1]]
        by_advancer = {advancer[pm["id"]]: pm for pm in prior if pm["id"] in advancer}
        for m in sorted(by_round[rnd], key=lambda x: (x.get("date") or "", x["id"])):
            fh = by_advancer.get(team_key(m.get("home")))
            fa = by_advancer.get(team_key(m.get("away")))
            if not fh or not fa:
                print(f"  ! {rnd} {m['id']}: could not resolve both feeders (game not final?)")
                continue
            out.append({"match_id": m["id"], "round": rnd, "date": m["date"],
                        "feeders": [fh["id"], fa["id"]], "take": "winners"})

    # optional 3rd-place match: the two semifinal LOSERS
    third = (by_round.get("3rd-place-match") or [None])[0]
    if third and "semifinals" in by_round:
        sfs = sorted(by_round["semifinals"], key=lambda x: (x.get("date") or "", x["id"]))
        out.append({"match_id": third["id"], "round": "3rd-place-match", "date": third["date"],
                    "feeders": [sf["id"] for sf in sfs], "take": "losers"})

    doc = {
        "note": f"Knockout feeder connectivity derived from completed fixtures ({args.fixtures}).",
        "source": "winner-tracing over the fetched results (build_ko_bracket.py)",
        "matches": out,
    }
    json.dump(doc, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Wrote {len(out)} feeder entries -> {args.out}")


if __name__ == "__main__":
    main()
