#!/usr/bin/env python3
"""
Add group information to group-stage matches in the fixtures JSON.

Reads:
    ../data/wc2026_fixtures.json   (produced by fetch_fixtures.py)
    ../data/groups.csv             (columns: group, team_abbreviation)

For every group-stage match it looks up each team's abbreviation in groups.csv
and writes the group letter onto the match as `"group"` (e.g. "A"). Knockout
matches get `"group": null`. Both teams of a group match should map to the same
group; if they don't (or an abbreviation is unknown), it warns and leaves the
group as null rather than guessing.

Usage:
    python add_groups.py
    python add_groups.py --fixtures ../data/wc2026_fixtures.json \
                         --groups ../data/groups.csv --out ../data/wc2026_fixtures.json
"""

import argparse
import csv
import json
import sys


def load_group_map(path):
    """abbreviation -> group letter, e.g. {'MEX': 'A', ...}."""
    mapping = {}
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required = {"group", "team_abbreviation"}
        if not required.issubset({h.strip() for h in (reader.fieldnames or [])}):
            sys.exit(f"groups.csv must have columns {sorted(required)}; "
                     f"found {reader.fieldnames}")
        for row in reader:
            abbr = (row.get("team_abbreviation") or "").strip().upper()
            grp = (row.get("group") or "").strip()
            if abbr:
                mapping[abbr] = grp
    return mapping


def group_for_match(match, gmap, warnings):
    home = (match.get("home") or {}).get("abbreviation")
    away = (match.get("away") or {}).get("abbreviation")
    h = gmap.get((home or "").upper())
    a = gmap.get((away or "").upper())

    missing = [abbr for abbr, g in ((home, h), (away, a)) if g is None]
    if missing:
        warnings.append(
            f"  match {match.get('id')} ({match.get('shortName') or match.get('name')}): "
            f"no group found for {', '.join(str(m) for m in missing)}")
        return None
    if h != a:
        warnings.append(
            f"  match {match.get('id')} ({match.get('shortName') or match.get('name')}): "
            f"teams map to different groups ({home}->{h}, {away}->{a})")
        return None
    return h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="../data/wc2026_fixtures.json")
    ap.add_argument("--groups", default="../data/groups.csv")
    ap.add_argument("--out", default=None,
                    help="output path (defaults to overwriting --fixtures in place)")
    args = ap.parse_args()
    out_path = args.out or args.fixtures

    with open(args.fixtures, encoding="utf-8") as f:
        data = json.load(f)
    gmap = load_group_map(args.groups)
    print(f"Loaded {len(gmap)} teams from {args.groups}")

    matches = data.get("matches", [])
    warnings = []
    n_group, n_knockout, n_set = 0, 0, 0

    for m in matches:
        stage = m.get("stage") or {}
        if stage.get("slug") == "group-stage":
            n_group += 1
            grp = group_for_match(m, gmap, warnings)
            m["group"] = grp
            if grp is not None:
                n_set += 1
        else:
            n_knockout += 1
            m["group"] = None

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Group-stage matches: {n_group} (group set on {n_set})")
    print(f"Knockout matches:    {n_knockout} (group = null)")
    if warnings:
        print(f"\n{len(warnings)} warning(s) — group left null for these:")
        print("\n".join(warnings))
        print("\nTip: mismatches are usually an abbreviation that differs between "
              "groups.csv and ESPN's feed. Compare against the home/away "
              "'abbreviation' values in the JSON and fix groups.csv.")
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
