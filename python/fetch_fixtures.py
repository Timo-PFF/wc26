#!/usr/bin/env python3
"""
Fetch 2026 FIFA World Cup fixtures from ESPN, day by day, and save to JSON.

Pulls each date from 2026-06-11 through 2026-07-19 (the API caps how much it
returns per request, so we page one day at a time and merge), then writes a
clean, de-duplicated list of matches with the fields we care about:

    id, date, name, status, venue, both teams (full + short names, abbr, logo),
    score, winner, and betting odds.

Usage:
    python fetch_fixtures.py                      # -> wc2026_fixtures.json
    python fetch_fixtures.py --out my.json        # custom output path
    python fetch_fixtures.py --start 20260611 --end 20260719

Re-run any time to refresh scores/odds; finished matches will have real scores
and a winner, scheduled ones won't.
"""

import argparse
import datetime as dt
import json
import sys
import time
from collections import Counter

import requests

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
HEADERS = {"User-Agent": "wc2026-pool/1.0 (personal use)"}

# ESPN carries the stage on each event under `season.slug` / `season.type`.
# Map the slug -> a friendly label; "group-stage" is the only non-knockout one.
STAGE_LABELS = {
    "group-stage": "Group Stage",
    "round-of-32": "Round of 32",
    "round-of-16": "Round of 16",
    "quarterfinals": "Quarterfinals",
    "semifinals": "Semifinals",
    "3rd-place-match": "Third-Place Match",
    "final": "Final",
}


# ---- field extraction -----------------------------------------------------

def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def extract_team(competitor):
    t = competitor.get("team", {})
    state = competitor  # competitor holds score/winner
    return {
        "id": t.get("id"),
        "displayName": t.get("displayName"),
        "shortDisplayName": t.get("shortDisplayName"),
        "name": t.get("name"),
        "abbreviation": t.get("abbreviation"),
        "logo": t.get("logo"),
        "score": _int_or_none(state.get("score")),          # 90'/extra-time goals
        "shootout": _int_or_none(state.get("shootoutScore")),  # penalty tally, else None
        "winner": bool(state.get("winner", False)),
    }


def extract_odds(comp):
    """Flatten ESPN's first odds entry into something compact.

    Many matches (especially knockout placeholders, or any game before a
    sportsbook has posted a line) have no odds at all, or a partial/odd-shaped
    block. Anything missing or unexpected just yields None rather than raising.
    """
    odds_list = comp.get("odds")
    if not isinstance(odds_list, list) or not odds_list:
        return None
    o = odds_list[0]
    if not isinstance(o, dict):
        return None

    def safe_get(node, key):
        return node.get(key) if isinstance(node, dict) else None

    def close_odds(node):
        if not isinstance(node, dict):
            return None
        c = node.get("close") or node.get("current") or node.get("open")
        return c.get("odds") if isinstance(c, dict) else None

    try:
        ml = o.get("moneyline") if isinstance(o.get("moneyline"), dict) else {}
        spread = o.get("pointSpread") if isinstance(o.get("pointSpread"), dict) else {}
        spread_home = spread.get("home") if isinstance(spread.get("home"), dict) else {}
        spread_close = spread_home.get("close") if isinstance(spread_home.get("close"), dict) else {}

        return {
            "provider": safe_get(o.get("provider"), "name"),
            "details": o.get("details"),          # e.g. "MEX -230"
            "overUnder": o.get("overUnder"),
            "moneyline": {
                "home": close_odds(ml.get("home")),
                "away": close_odds(ml.get("away")),
                "draw": close_odds(ml.get("draw")),
            },
            "spread": {
                "line": spread_close.get("line"),
                "odds": spread_close.get("odds"),
            },
        }
    except Exception:  # noqa: BLE001 — never let odds parsing kill the run
        return None


def extract_stage(event):
    """Stage info from the event's own `season` block (not the league default)."""
    season = event.get("season") if isinstance(event.get("season"), dict) else {}
    slug = season.get("slug")
    return {
        "slug": slug,                                  # e.g. "group-stage", "round-of-16"
        "type": season.get("type"),                    # numeric ESPN code, e.g. 13802
        "label": STAGE_LABELS.get(slug, slug),         # friendly name
        "knockout": bool(slug) and slug != "group-stage",
    }


def determine_winner(home, away, completed):
    if not completed:
        return None
    if home["winner"]:
        return "home"
    if away["winner"]:
        return "away"
    if home["score"] is not None and away["score"] is not None:
        return "draw" if home["score"] == away["score"] else None
    return None


def extract_match(event):
    comp = event["competitions"][0]
    competitors = comp.get("competitors", [])
    home_c = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away_c = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home_c or not away_c:
        return None

    home = extract_team(home_c)
    away = extract_team(away_c)

    status_type = comp.get("status", {}).get("type", {})
    completed = bool(status_type.get("completed"))
    state = status_type.get("state")  # pre | in | post

    # How a finished knockout was decided (ESPN encodes this in the status name).
    # `score` is always the 90'/extra-time score; for penalties it's the draw and
    # the deciding tally lives in each team's `shootout`.
    name = status_type.get("name")
    if not completed:
        decided_by = None
    elif name == "STATUS_FINAL_PEN":
        decided_by = "penalties"
    elif name == "STATUS_FINAL_AET":
        decided_by = "extra_time"
    else:
        decided_by = "regulation"

    # Don't report a 0-0 "score" for matches that haven't kicked off.
    if state == "pre":
        home["score"] = None
        away["score"] = None
        home["winner"] = False
        away["winner"] = False

    venue = comp.get("venue", {}) or {}
    addr = venue.get("address", {}) or {}

    return {
        "id": event.get("id"),
        "date": event.get("date"),
        "name": event.get("name"),
        "shortName": event.get("shortName"),
        "stage": extract_stage(event),
        "status": {
            "name": status_type.get("name"),
            "state": state,
            "completed": completed,
            "detail": status_type.get("detail"),
            "shortDetail": status_type.get("shortDetail"),
        },
        "venue": {
            "fullName": venue.get("fullName"),
            "city": addr.get("city"),
            "country": addr.get("country"),
        },
        "home": home,
        "away": away,
        "winner": determine_winner(home, away, completed),
        "decidedBy": decided_by,
        "odds": extract_odds(comp),
    }


# ---- validation -----------------------------------------------------------
# The WC2026 schedule is fixed: 104 matches in known per-stage counts. We refuse
# to write the output unless a fetch reproduces this exactly, so a partial or
# garbled API response (e.g. a transient ESPN hiccup during an automated refresh)
# can never overwrite the good fixtures file with junk.

EXPECTED_STAGE_COUNTS = {
    "group-stage": 72,
    "round-of-32": 16,
    "round-of-16": 8,
    "quarterfinals": 4,
    "semifinals": 2,
    "3rd-place-match": 1,
    "final": 1,
}
EXPECTED_TOTAL = sum(EXPECTED_STAGE_COUNTS.values())  # 104


class FixturesValidationError(Exception):
    """Raised when a fetched schedule doesn't look like the full WC2026 fixture set."""


def validate_matches(matches):
    """Raise FixturesValidationError unless `matches` is the complete, well-formed
    WC2026 schedule. Collects every problem so one run reports them all."""
    problems = []

    if len(matches) != EXPECTED_TOTAL:
        problems.append(f"expected {EXPECTED_TOTAL} matches, got {len(matches)}")

    ids = [m.get("id") for m in matches]
    if any(not i for i in ids):
        problems.append("match(es) with a missing id")
    if len(set(ids)) != len(ids):
        problems.append("duplicate match ids")

    counts = Counter((m.get("stage") or {}).get("slug") for m in matches)
    for slug, want in EXPECTED_STAGE_COUNTS.items():
        if counts.get(slug, 0) != want:
            problems.append(f"stage {slug!r}: expected {want}, got {counts.get(slug, 0)}")
    unknown = sorted(s for s in counts if s not in EXPECTED_STAGE_COUNTS)
    if unknown:
        problems.append(f"unexpected stage(s): {unknown}")

    for m in matches:
        if not m.get("date"):
            problems.append(f"match {m.get('id')}: missing date")
        for side in ("home", "away"):
            team = m.get(side) or {}
            if not (team.get("abbreviation") or team.get("displayName")):
                problems.append(f"match {m.get('id')}: {side} team has no name/abbreviation")

    if problems:
        raise FixturesValidationError("; ".join(problems))


# ---- fetching -------------------------------------------------------------

def daterange(start, end):
    d = start
    one = dt.timedelta(days=1)
    while d <= end:
        yield d
        d += one


def fetch_day(day, session, retries=3):
    params = {"dates": day.strftime("%Y%m%d"), "limit": 950}
    for attempt in range(1, retries + 1):
        try:
            r = session.get(BASE, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return r.json().get("events", [])
        except Exception as exc:  # noqa: BLE001
            if attempt == retries:
                print(f"  ! {day:%Y-%m-%d}: giving up after {retries} tries ({exc})",
                      file=sys.stderr)
                return []
            time.sleep(1.5 * attempt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="20260611")
    ap.add_argument("--end", default="20260719")
    ap.add_argument("--out", default="../data/wc2026_fixtures.json")
    ap.add_argument("--delay", type=float, default=0.4,
                    help="seconds to wait between daily requests (be polite)")
    ap.add_argument("--no-validate", action="store_true",
                    help="skip the full-schedule sanity check (e.g. for a partial date range)")
    args = ap.parse_args()

    start = dt.datetime.strptime(args.start, "%Y%m%d").date()
    end = dt.datetime.strptime(args.end, "%Y%m%d").date()

    session = requests.Session()
    by_id = {}
    days = list(daterange(start, end))
    print(f"Fetching {len(days)} day(s): {start} -> {end}")

    for day in days:
        events = fetch_day(day, session)
        added = 0
        for ev in events:
            m = extract_match(ev)
            if not m or not m["id"]:
                continue
            # Later pulls overwrite earlier ones (keeps freshest score/odds).
            if m["id"] not in by_id:
                added += 1
            by_id[m["id"]] = m
        print(f"  {day:%Y-%m-%d}: {len(events):3d} event(s), +{added} new")
        time.sleep(args.delay)

    matches = sorted(by_id.values(), key=lambda m: (m["date"] or "", m["id"]))

    # Sanity-check before writing — a bad fetch must not overwrite a good file.
    if not args.no_validate:
        try:
            validate_matches(matches)
        except FixturesValidationError as exc:
            print(f"\n! Refusing to write {args.out} — schedule failed validation:\n  {exc}",
                  file=sys.stderr)
            print("  (re-run when ESPN is healthy, or pass --no-validate for a partial fetch)",
                  file=sys.stderr)
            sys.exit(1)

    payload = {
        "source": "ESPN site.api scoreboard (fifa.world)",
        "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        "range": {"start": args.start, "end": args.end},
        "count": len(matches),
        "matches": matches,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    finished = sum(1 for m in matches if m["status"]["completed"])
    print(f"\nSaved {len(matches)} matches ({finished} finished) -> {args.out}")


if __name__ == "__main__":
    main()
