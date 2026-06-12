#!/usr/bin/env python3
"""
Fetch (pre-game odds -> final score) training rows from ESPN, for any soccer
league and date range, and append them to a tidy CSV.

Why two endpoints:
  - The public *scoreboard* (`.../<league>/scoreboard?dates=...`) lists the games
    in a date range with final scores and stage — but it DROPS the odds block once
    a game is over.
  - The deeper *core* odds API
    (`sports.core.api.espn.com/.../events/<id>/competitions/<id>/odds`) RETAINS the
    full historical odds (many sportsbooks) for finished games, going back years.

So we enumerate finished games from the scoreboard, then pull each game's odds from
the core API and flatten one chosen sportsbook's 3-way moneyline + over/under into a
row alongside the final score.

The expensive part is one core-odds request per game, so every raw odds response is
cached on disk (`--cache-dir`); re-runs are nearly free and resumable. The output
CSV is cumulative and idempotent: a re-run merges rows by (league, event_id).

Examples:
    # One EPL season:
    python fetch_odds_results.py --leagues eng.1 --start 20240811 --end 20250525
    # The 2022 World Cup (training) and 2026 World Cup (to apply the model):
    python fetch_odds_results.py --leagues fifa.world --start 20221120 --end 20221218
    python fetch_odds_results.py --leagues fifa.world --start 20260611 --end 20260719
    # Several top leagues at once over the same window:
    python fetch_odds_results.py --leagues eng.1,esp.1,ita.1,ger.1,fra.1 \
                                 --start 20230801 --end 20240601
"""

import argparse
import csv
import datetime as dt
import json
import os
import sys
import time

import requests

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard"
CORE_ODDS = ("https://sports.core.api.espn.com/v2/sports/soccer/leagues/{league}"
             "/events/{event}/competitions/{event}/odds")
HEADERS = {"User-Agent": "wc2026-pool/1.0 (personal use)"}

# Sportsbooks to prefer when a game has lines from several, most-trusted first.
# We take the first preferred book that has a complete 3-way moneyline + total;
# failing that, the first complete book of any name. Matched case-insensitively
# on a substring so "Bet365" and "Bet 365" both hit "bet365"/"bet 365".
PREFERRED_PROVIDERS = ["bet365", "bet 365", "draftkings", "caesars", "unibet", "betfair"]

# How a finished game was decided (from the scoreboard status name). The 3-way
# moneyline is priced on 90 minutes, so knockout games settled in extra time /
# penalties carry a score that may not match what the moneyline priced — the
# modeling step can filter on `decided_by` / `knockout`.
DECIDED_BY = {
    "STATUS_FINAL_PEN": "penalties",
    "STATUS_FINAL_AET": "extra_time",
}

# Stage slugs that are single-elimination rounds (where a game can go to extra
# time / penalties, so the stored score may differ from the 90' result the 3-way
# moneyline was priced on). Everything else — group stage, any league season slug
# like "2025-26-english-premier-league" — is treated as a normal 90-minute game.
KNOCKOUT_SLUGS = {
    "round-of-64", "round-of-32", "round-of-16", "quarterfinals",
    "semifinals", "3rd-place-match", "final",
}

CSV_COLUMNS = [
    "league", "season", "date", "stage", "knockout", "decided_by",
    "event_id", "home", "away", "home_id", "away_id",
    "home_score", "away_score",
    "provider", "home_ml", "draw_ml", "away_ml",
    "over_under", "over_odds", "under_odds",
]


# ---- small helpers --------------------------------------------------------

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


def daterange_chunks(start, end, days):
    """Yield (chunk_start, chunk_end) date pairs covering [start, end]."""
    step = dt.timedelta(days=days - 1)
    one = dt.timedelta(days=1)
    cur = start
    while cur <= end:
        chunk_end = min(cur + step, end)
        yield cur, chunk_end
        cur = chunk_end + one


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


# ---- scoreboard: enumerate finished games ---------------------------------

def finished_games(session, league, start, end, chunk_days, delay):
    """Return a list of finished-game dicts (id, teams, score, stage, ...)."""
    games = {}
    for c_start, c_end in daterange_chunks(start, end, chunk_days):
        dates = f"{c_start:%Y%m%d}-{c_end:%Y%m%d}"
        data = get_json(session, SCOREBOARD.format(league=league),
                        params={"dates": dates, "limit": 1000})
        events = (data or {}).get("events", []) or []
        added = 0
        for ev in events:
            g = _parse_scoreboard_event(ev)
            if g and g["event_id"] not in games:
                games[g["event_id"]] = g
                added += 1
        print(f"  [{league}] {dates}: {len(events):3d} event(s), +{added} finished")
        time.sleep(delay)
    return list(games.values())


def _parse_scoreboard_event(ev):
    comp = (ev.get("competitions") or [{}])[0]
    status = (comp.get("status") or {}).get("type", {}) or {}
    if not status.get("completed"):
        return None  # only finished games are training rows

    competitors = comp.get("competitors", []) or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None
    home_score, away_score = _num(home.get("score")), _num(away.get("score"))
    if home_score is None or away_score is None:
        return None

    season = ev.get("season") if isinstance(ev.get("season"), dict) else {}
    slug = season.get("slug")
    date = ev.get("date") or ""
    return {
        "event_id": ev.get("id"),
        "date": date,
        # Soccer seasons span two years; fall back to the calendar year of the date.
        "season": season.get("year") or (int(date[:4]) if date[:4].isdigit() else None),
        "stage": slug,
        "knockout": slug in KNOCKOUT_SLUGS,
        "decided_by": DECIDED_BY.get(status.get("name"), "regulation"),
        "home": (home.get("team") or {}).get("abbreviation"),
        "away": (away.get("team") or {}).get("abbreviation"),
        "home_id": (home.get("team") or {}).get("id"),
        "away_id": (away.get("team") or {}).get("id"),
        "home_score": home_score,
        "away_score": away_score,
    }


# ---- core odds: pre-game lines for a single game --------------------------

def fetch_odds_items(session, league, event_id, cache_dir, delay):
    """Return the core-odds `items` list for one game, cached on disk."""
    path = os.path.join(cache_dir, f"{league}_{event_id}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("items", []) or []
    data = get_json(session, CORE_ODDS.format(league=league, event=event_id))
    time.sleep(delay)
    if data is None:
        return []
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data.get("items", []) or []


def _complete_line(item):
    """Flatten one sportsbook entry to (home_ml, draw_ml, away_ml, ou, over, under),
    or None if it lacks a full 3-way moneyline + total."""
    home = (item.get("homeTeamOdds") or {})
    away = (item.get("awayTeamOdds") or {})
    draw = (item.get("drawOdds") or {})
    h = _num(home.get("moneyLine"))
    a = _num(away.get("moneyLine"))
    d = _num(draw.get("moneyLine"))
    ou = _num(item.get("overUnder"))
    if h is None or a is None or d is None or ou is None:
        return None
    return h, d, a, ou, _num(item.get("overOdds")), _num(item.get("underOdds"))


def choose_line(items):
    """Pick a sportsbook's line, preferring trusted books, then any complete one.
    Returns (provider_name, home_ml, draw_ml, away_ml, ou, over, under) or None."""
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


# ---- CSV (cumulative + idempotent) ----------------------------------------

def load_existing(path):
    rows = {}
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows[(row["league"], row["event_id"])] = row
    return rows


def write_csv(path, rows_by_key):
    rows = sorted(rows_by_key.values(),
                  key=lambda r: (r["league"], str(r["date"]), str(r["event_id"])))
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


# ---- main -----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default="eng.1",
                    help="comma-separated ESPN league slugs (e.g. eng.1,esp.1,fifa.world)")
    ap.add_argument("--start", required=True, help="YYYYMMDD inclusive")
    ap.add_argument("--end", required=True, help="YYYYMMDD inclusive")
    ap.add_argument("--out", default="../data/training_odds.csv")
    ap.add_argument("--cache-dir", default="../data/odds_cache")
    ap.add_argument("--chunk-days", type=int, default=10,
                    help="scoreboard date-window size per request")
    ap.add_argument("--delay", type=float, default=0.3,
                    help="seconds between requests (be polite)")
    args = ap.parse_args()

    start = dt.datetime.strptime(args.start, "%Y%m%d").date()
    end = dt.datetime.strptime(args.end, "%Y%m%d").date()
    leagues = [s.strip() for s in args.leagues.split(",") if s.strip()]
    os.makedirs(args.cache_dir, exist_ok=True)

    session = requests.Session()
    rows = load_existing(args.out)
    n_start = len(rows)
    added = no_odds = 0

    for league in leagues:
        print(f"\n=== {league}: {start} -> {end} ===")
        games = finished_games(session, league, start, end, args.chunk_days, args.delay)
        print(f"  {len(games)} finished game(s); fetching odds…")
        for i, g in enumerate(games, 1):
            items = fetch_odds_items(session, league, g["event_id"],
                                     args.cache_dir, args.delay)
            line = choose_line(items)
            if not line:
                no_odds += 1
                continue
            provider, h_ml, d_ml, a_ml, ou, over, under = line
            rows[(league, g["event_id"])] = {
                "league": league, **g,
                "provider": provider, "home_ml": h_ml, "draw_ml": d_ml,
                "away_ml": a_ml, "over_under": ou, "over_odds": over,
                "under_odds": under,
            }
            added += 1
            if i % 50 == 0:
                print(f"    …{i}/{len(games)}")

    total = write_csv(args.out, rows)
    print(f"\nWrote {total} row(s) to {args.out} "
          f"(+{len(rows) - n_start} new this run; "
          f"{added} with odds, {no_odds} finished games had no usable odds).")


if __name__ == "__main__":
    main()
