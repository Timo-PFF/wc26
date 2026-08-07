#!/usr/bin/env python3
"""Refresh a tournament's finished-guesses snapshot from the live D1.

During a tournament, run this manually every so often (e.g. after a matchday). It:
  1. reads the tournament's fixtures (path from data/tournaments.json) and finds the
     FINISHED games — those with status.completed and a final score,
  2. pulls every guess for the tournament out of D1 (via `wrangler d1 execute`),
  3. rewrites data/<tid>/<tid>_historical_guesses.csv with the per-player picks for
     exactly those finished games (columns: player,matchId,home,away,penaltyWinner).

The Worker serves only the LIVE games (fixture ids NOT in this snapshot), so freezing
a finished game into the snapshot removes it from D1 read traffic. Running this as
games finish keeps the tournament's D1 row reads low. Commit + push the CSV afterwards
— the Worker and frontend read it from the raw repo URL, not from D1.

Run it where `npx wrangler` works (WSL):
  py -3 python/refresh_historical.py <tournament_id>
  py -3 python/refresh_historical.py euro2024 --local     # test against the local D1
  py -3 python/refresh_historical.py wc2026   --dry-run    # show counts, write nothing
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "tournaments.json")
CLOUDFLARE = os.path.join(ROOT, "cloudflare")
D1_NAME = "wc26"                    # database_name in wrangler.toml
LOCAL_CONFIG = "wrangler.v2.toml"   # local-dev D1 namespace (see cloudflare/README.md)
SNAPSHOT_HEADER = "player,matchId,home,away,penaltyWinner"


def tournament_entry(tid):
    """The manifest entry for a tournament id (validates the id is real)."""
    cfg = json.load(open(MANIFEST, encoding="utf-8"))
    for t in cfg.get("tournaments", []):
        if t["id"] == tid:
            return t
    ids = ", ".join(t["id"] for t in cfg.get("tournaments", []))
    raise SystemExit(f"tournament '{tid}' not in {MANIFEST} (known: {ids})")


def finished_match_ids(fixtures_path):
    """matchIds of games that have a final score (status.completed + both scores)."""
    fx = json.load(open(fixtures_path, encoding="utf-8"))
    matches = fx.get("matches", []) if isinstance(fx, dict) else fx
    ids = set()
    for m in matches:
        status = m.get("status") or {}
        home = (m.get("home") or {}).get("score")
        away = (m.get("away") or {}).get("score")
        if status.get("completed") and home is not None and away is not None:
            ids.add(str(m["id"]))
    return ids


def _parse_json(stdout):
    """wrangler --json prints a JSON array; tolerate a banner leaking ahead of it."""
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        for bracket in ("[", "{"):
            i = stdout.find(bracket)
            if i >= 0:
                try:
                    return json.loads(stdout[i:])
                except json.JSONDecodeError:
                    pass
        raise


def d1_query(sql, local):
    """Run a read-only SQL statement against D1 and return its result rows."""
    cmd = ["npx", "wrangler", "d1", "execute", D1_NAME]
    cmd += ["--local", "--config", LOCAL_CONFIG] if local else ["--remote"]
    cmd += ["--command", sql, "--json"]
    proc = subprocess.run(cmd, cwd=CLOUDFLARE, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"wrangler failed (exit {proc.returncode}) for: {sql}")
    raw = _parse_json(proc.stdout)
    return raw[0]["results"] if isinstance(raw, list) else raw.get("results", [])


def build_rows(tid, finished, local):
    """(player, matchId, home, away, penaltyWinner) tuples for finished-game guesses."""
    names = {str(r["id"]): str(r["name"]).strip()
             for r in d1_query("SELECT id, name FROM users", local)}
    # tid is a validated manifest id (a slug), so inlining it is safe.
    guesses = d1_query(
        "SELECT userId, matchId, guessHome, guessAway, penaltyWinner "
        f"FROM guesses WHERE tournamentId = '{tid}'", local)
    rows = []
    for g in guesses:
        mid = str(g["matchId"])
        name = names.get(str(g["userId"]))
        if mid not in finished or not name:
            continue
        if g.get("guessHome") is None or g.get("guessAway") is None:
            continue
        pen = g.get("penaltyWinner") or ""
        rows.append((name, mid, int(g["guessHome"]), int(g["guessAway"]), pen))
    rows.sort(key=lambda r: (r[0].lower(), int(r[1])))
    return rows


def main():
    ap = argparse.ArgumentParser(description="Refresh a tournament's finished-guesses snapshot from D1.")
    ap.add_argument("tournament", help="tournament id (e.g. wc2026, euro2024)")
    ap.add_argument("--local", action="store_true", help="query the LOCAL D1 (wrangler.v2.toml) instead of --remote")
    ap.add_argument("--dry-run", action="store_true", help="print counts but do not write the CSV")
    args = ap.parse_args()

    entry = tournament_entry(args.tournament)
    fixtures_path = os.path.join(ROOT, entry["files"]["fixtures"])
    out_path = os.path.join(ROOT, entry["files"]["historicalGuesses"])

    finished = finished_match_ids(fixtures_path)
    print(f"{args.tournament}: {len(finished)} finished game(s) in {os.path.relpath(fixtures_path, ROOT)}")

    rows = build_rows(args.tournament, finished, args.local) if finished else []
    if not finished:
        print("WARNING: no finished games detected — snapshot will be EMPTY (every game served live from D1).")

    players = len({r[0] for r in rows})
    print(f"{len(rows)} guess row(s) from {players} player(s).")

    if args.dry_run:
        print(f"(dry-run) would write {os.path.relpath(out_path, ROOT)}")
        return

    body = "\n".join([SNAPSHOT_HEADER] + [f"{n},{mid},{h},{a},{p}" for (n, mid, h, a, p) in rows]) + "\n"
    open(out_path, "w", encoding="utf-8", newline="\n").write(body)
    print(f"Wrote {os.path.relpath(out_path, ROOT)}")
    print("Now commit + push the CSV so the Worker/frontend pick it up (read from the raw repo URL).")


if __name__ == "__main__":
    main()
