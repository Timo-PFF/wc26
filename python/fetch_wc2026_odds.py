#!/usr/bin/env python3
"""
Snapshot the LATEST 2026 World Cup odds (every game, any status) into a CSV.

For each match it records one sportsbook's 3-way moneyline + over/under:
  - finished games  -> the closing line (the last odds ESPN holds, frozen at kickoff)
  - upcoming games  -> the latest live line
  - in-progress     -> the line as it stood (kept for completeness; no final score yet)

Unlike fetch_odds_results.py (the historical TRAINING collector, which keeps only
finished games and caches responses), this is an APPLY-time snapshot: it always
hits the API fresh and rewrites the whole CSV, so each run reflects the current
market. Re-run it whenever you want refreshed lines before a slate of games.

The score columns are filled only for finished games (the outcome you're
predicting); upcoming/in-progress rows leave them blank.

Usage:
    python fetch_wc2026_odds.py                       # -> ../data/wc2026_odds.csv
    python fetch_wc2026_odds.py --out my_odds.csv
    python fetch_wc2026_odds.py --start 20260611 --end 20260719
"""

import argparse
import csv
import datetime as dt
import sys
import time

import requests

LEAGUE = "fifa.world"
SCOREBOARD = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE}/scoreboard"
CORE_ODDS = (f"https://sports.core.api.espn.com/v2/sports/soccer/leagues/{LEAGUE}"
             "/events/{event}/competitions/{event}/odds")
HEADERS = {"User-Agent": "wc2026-pool/1.0 (personal use)"}

# Sportsbooks to prefer, most-trusted first; we take the first preferred book with
# a complete 3-way moneyline + total, else the first complete book of any name.
PREFERRED_PROVIDERS = ["bet365", "bet 365", "draftkings", "caesars", "unibet", "betfair"]

KNOCKOUT_SLUGS = {
    "round-of-64", "round-of-32", "round-of-16", "quarterfinals",
    "semifinals", "3rd-place-match", "final",
}
DECIDED_BY = {"STATUS_FINAL_PEN": "penalties", "STATUS_FINAL_AET": "extra_time"}

CSV_COLUMNS = [
    "event_id", "date", "stage", "knockout", "state", "status_detail",
    "home", "away", "home_id", "away_id", "home_score", "away_score", "decided_by",
    "provider", "home_ml", "draw_ml", "away_ml",
    "over_under", "over_odds", "under_odds",
]


# ---- helpers --------------------------------------------------------------

def _num(v):
    """ESPN mixes ints, floats and strings like '+220' for American odds."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return int(str(v).replace("+", "").strip())
    except (TypeError, ValueError):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None


def get_json(session, url, params=None, retries=3):
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001
            if attempt == retries:
                print(f"  ! giving up on {url} ({exc})", file=sys.stderr)
                return None
            time.sleep(1.5 * attempt)


def daterange_chunks(start, end, days):
    step = dt.timedelta(days=days - 1)
    one = dt.timedelta(days=1)
    cur = start
    while cur <= end:
        chunk_end = min(cur + step, end)
        yield cur, chunk_end
        cur = chunk_end + one


# ---- scoreboard: every game, any status ----------------------------------

def all_games(session, start, end, chunk_days, delay):
    games = {}
    for c_start, c_end in daterange_chunks(start, end, chunk_days):
        dates = f"{c_start:%Y%m%d}-{c_end:%Y%m%d}"
        data = get_json(session, SCOREBOARD, params={"dates": dates, "limit": 1000})
        events = (data or {}).get("events", []) or []
        for ev in events:
            g = _parse_event(ev)
            if g:
                games[g["event_id"]] = g
        print(f"  {dates}: {len(events):3d} event(s)")
        time.sleep(delay)
    return list(games.values())


def _parse_event(ev):
    comp = (ev.get("competitions") or [{}])[0]
    status = (comp.get("status") or {}).get("type", {}) or {}
    state = status.get("state")          # pre | in | post
    completed = bool(status.get("completed"))

    competitors = comp.get("competitors", []) or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None

    season = ev.get("season") if isinstance(ev.get("season"), dict) else {}
    slug = season.get("slug")
    # Score only for finished games (the outcome we predict); blank otherwise.
    home_score = _num(home.get("score")) if completed else None
    away_score = _num(away.get("score")) if completed else None
    return {
        "event_id": ev.get("id"),
        "date": ev.get("date") or "",
        "stage": slug,
        "knockout": slug in KNOCKOUT_SLUGS,
        "state": state,
        "status_detail": status.get("shortDetail"),
        "home": (home.get("team") or {}).get("abbreviation"),
        "away": (away.get("team") or {}).get("abbreviation"),
        "home_id": (home.get("team") or {}).get("id"),
        "away_id": (away.get("team") or {}).get("id"),
        "home_score": home_score,
        "away_score": away_score,
        "decided_by": DECIDED_BY.get(status.get("name"), "regulation") if completed else None,
    }


# ---- core odds: latest / closing line for one game ------------------------

def _complete_line(item):
    """(home_ml, draw_ml, away_ml, ou, over, under) or None if 3-way+total incomplete.

    The flat `moneyLine` fields hold the current line — which for a finished game
    is the closing line, and for an upcoming game the latest live price."""
    h = _num((item.get("homeTeamOdds") or {}).get("moneyLine"))
    a = _num((item.get("awayTeamOdds") or {}).get("moneyLine"))
    d = _num((item.get("drawOdds") or {}).get("moneyLine"))
    ou = _num(item.get("overUnder"))
    if h is None or a is None or d is None or ou is None:
        return None
    return h, d, a, ou, _num(item.get("overOdds")), _num(item.get("underOdds"))


def latest_line(session, event_id, delay):
    """Return (provider, home_ml, draw_ml, away_ml, ou, over, under) or None.
    Always fetched fresh — no cache — so the line is current."""
    data = get_json(session, CORE_ODDS.format(event=event_id))
    time.sleep(delay)
    items = (data or {}).get("items", []) or []
    complete = []
    for it in items:
        line = _complete_line(it)
        if line:
            complete.append(((it.get("provider") or {}).get("name") or "", line))
    if not complete:
        return None
    for pref in PREFERRED_PROVIDERS:
        for name, line in complete:
            if pref in name.lower():
                return (name, *line)
    name, line = complete[0]
    return (name, *line)


# ---- main -----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="20260611", help="YYYYMMDD inclusive")
    ap.add_argument("--end", default="20260719", help="YYYYMMDD inclusive")
    ap.add_argument("--out", default="../data/wc2026_odds.csv")
    ap.add_argument("--chunk-days", type=int, default=10)
    ap.add_argument("--delay", type=float, default=0.3)
    args = ap.parse_args()

    start = dt.datetime.strptime(args.start, "%Y%m%d").date()
    end = dt.datetime.strptime(args.end, "%Y%m%d").date()

    session = requests.Session()
    print(f"WC2026 odds snapshot: {start} -> {end}")
    games = all_games(session, start, end, args.chunk_days, args.delay)
    games.sort(key=lambda g: (g["date"], g["event_id"]))
    print(f"  {len(games)} game(s); fetching latest odds…")

    rows, no_odds = [], 0
    for i, g in enumerate(games, 1):
        line = latest_line(session, g["event_id"], args.delay)
        if not line:
            no_odds += 1
            row = {**g, "provider": None, "home_ml": None, "draw_ml": None,
                   "away_ml": None, "over_under": None, "over_odds": None,
                   "under_odds": None}
        else:
            provider, h_ml, d_ml, a_ml, ou, over, under = line
            row = {**g, "provider": provider, "home_ml": h_ml, "draw_ml": d_ml,
                   "away_ml": a_ml, "over_under": ou, "over_odds": over,
                   "under_odds": under}
        rows.append(row)
        if i % 25 == 0:
            print(f"    …{i}/{len(games)}")

    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(rows)

    by_state = {}
    for g in games:
        by_state[g["state"]] = by_state.get(g["state"], 0) + 1
    print(f"\nWrote {len(rows)} row(s) to {args.out}")
    print(f"  by state: {by_state} | {no_odds} game(s) had no usable odds line")


if __name__ == "__main__":
    main()
