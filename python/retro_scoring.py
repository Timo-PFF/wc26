#!/usr/bin/env python3
"""Retrospective scoring harness for the WC2026 pool (scratch analysis, not shipped).

Loads the D1 guesses export + the fixtures results and scores the pool under a
pluggable scheme:
  - BASELINE reproduces scoring.js exactly (group 3/2/1/0, knockout 4/3/2/1 + draw rules).
  - CONSENSUS (parimutuel): a fixed pool per game — group 3N, knockout 4N
    (N = qualified players) — split proportionally to each player's baseline points,
    with a per-player cap (group N, knockout 4/3 N) that rescales all points so the
    top scorer sits exactly at the cap (overflow discarded). Rewards being right
    against the crowd; mutes safe consensus picks.

Inputs (both under ../data/):
  guesses_export.json  — dump of the D1 `guesses` table. Re-create with:
      wrangler d1 execute wc26 --remote \
        --command "SELECT league,player,matchId,guessHome,guessAway,penaltyWinner FROM guesses" \
        --json > ../data/guesses_export.json
  wc2026_fixtures.json — results (scores + top-level `winner`/`decidedBy`).

RE-RUN after the final two games finish:
  1. python refresh_fixtures.py        (fresh results)
  2. re-export guesses_export.json     (command above)
  3. clear the now-played ids from EXCLUDE below
  4. py -3 retro_scoring.py

MIN_GAMES drops casual guessers (< that many scored games) so the field is
apples-to-apples (currently 9 family / 12 oppenheimer).
"""
import json
import os
from collections import defaultdict

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
GUESSES = os.path.join(BASE, "guesses_export.json")
FIXTURES = os.path.join(BASE, "wc2026_fixtures.json")
EXCLUDE = {"760516", "760517"}  # final + 3rd place: not played yet — clear once played
MIN_GAMES = 98                   # drop casual guessers (< this many games scored)

# ---- load results ---------------------------------------------------------
fx = json.load(open(FIXTURES, encoding="utf-8"))
MATCH = {}
for m in fx["matches"]:
    st = m.get("status") or {}
    if not st.get("completed"):
        continue
    MATCH[str(m["id"])] = {
        "ko": bool((m.get("stage") or {}).get("knockout")),
        "ah": (m.get("home") or {}).get("score"),
        "aa": (m.get("away") or {}).get("score"),
        "winner": m.get("winner"),          # 'home' | 'away'
        "decided_by": m.get("decidedBy") or "regulation",
    }

# ---- load guesses ---------------------------------------------------------
raw = json.load(open(GUESSES, encoding="utf-8"))
ROWS = raw[0]["results"] if isinstance(raw, list) else raw["results"]

# ---- scoring: baseline == scoring.js --------------------------------------
def score_group(gh, ga, ah, aa, S):
    if gh == ah and ga == aa:
        return S["exact"]
    go = (gh > ga) - (gh < ga)
    ao = (ah > aa) - (ah < aa)
    if go != ao:
        return 0
    if go == 0:
        return S["outcome"]
    if (gh - ga) == (ah - aa):
        return S["gd"]
    return S["outcome"]

def score_ko(guess, mt, K):
    gh, ga = guess["guessHome"], guess["guessAway"]
    ah, aa = mt["ah"], mt["aa"]
    pens = mt["decided_by"] == "penalties"
    adv = mt["winner"]
    exact = gh == ah and ga == aa
    if gh != ga:  # picked an outright winner
        pred = "home" if gh > ga else "away"
        if pens:
            return K["shootoutCalled"] if pred == adv else 0
        if pred != adv:
            return 0
        if exact:
            return K["exact"]
        if (gh - ga) == (ah - aa):
            return K["gd"]
        return K["winner"]
    # picked a draw + penalty winner
    pen_pick = guess.get("penaltyWinner") or ""
    if not pens:
        return K["penWinnerDecisive"] if pen_pick == adv else 0
    pts = K["drawBase"]
    if exact:
        pts += K["drawExactBonus"]
    if pen_pick == adv:
        pts += K["drawPenBonus"]
    return pts

def score_pick(guess, mt, scheme):
    if mt["ah"] is None or mt["aa"] is None:
        return 0
    if mt["ko"]:
        return score_ko(guess, mt, scheme["ko"])
    return score_group(guess["guessHome"], guess["guessAway"], mt["ah"], mt["aa"], scheme["group"])

BASELINE = {
    "group": {"exact": 3, "gd": 2, "outcome": 1},
    "ko": {"exact": 4, "gd": 3, "winner": 2, "shootoutCalled": 1,
           "drawBase": 2, "drawExactBonus": 1, "drawPenBonus": 1, "penWinnerDecisive": 1},
}

# ---- standings ------------------------------------------------------------
def standings(scheme):
    pts = defaultdict(float)      # (league, player) -> points
    played = defaultdict(int)     # games actually scored
    for r in ROWS:
        mid = str(r["matchId"])
        if mid in EXCLUDE or mid not in MATCH:
            continue
        pts[(r["league"], r["player"])] += score_pick(r, MATCH[mid], scheme)
        played[(r["league"], r["player"])] += 1
    return pts, played

def show(scheme, title):
    pts, played = standings(scheme)
    for lg in ("family", "oppenheimer"):
        rows = sorted([(p, pts[(lg, p)], played[(lg, p)]) for (l, p) in pts
                       if l == lg and played[(lg, p)] >= MIN_GAMES],
                      key=lambda x: -x[1])
        print(f"\n=== {title} — {lg} ===")
        for i, (p, pt, g) in enumerate(rows, 1):
            print(f"  {i:2d}. {p:<12} {pt:6.0f} pts   ({g} games)")

# ---- consensus (parimutuel) scoring ---------------------------------------
def qualified_sets():
    _, played = standings(BASELINE)
    q = defaultdict(list)
    for (lg, p), g in played.items():
        if g >= MIN_GAMES:
            q[lg].append(p)
    return q

# pool & per-player cap for a game. Group: 3N / 1N. Knockout: ko_pool_f·N / ko_cap_f·N.
def pool_cap(ko, N, ko_pool_f, ko_cap_f):
    return ((ko_pool_f if ko else 3.0) * N, (ko_cap_f if ko else 1.0) * N)

def consensus_standings(scheme, ko_pool_f=3.0, ko_cap_f=1.0):
    q = qualified_sets()
    gindex = {(r["league"], r["player"], str(r["matchId"])): r for r in ROWS}
    season = defaultdict(float)
    for mid, mt in MATCH.items():
        if mid in EXCLUDE:
            continue
        for lg, players in q.items():
            N = len(players)
            pool, cap = pool_cap(mt["ko"], N, ko_pool_f, ko_cap_f)
            raw = {p: (score_pick(gindex[(lg, p, mid)], mt, scheme) if (lg, p, mid) in gindex else 0)
                   for p in players}
            tot = sum(raw.values())
            if tot <= 0:
                continue
            norm = {p: raw[p] * pool / tot for p in players}      # split the pool
            mx = max(norm.values())
            if mx > cap:                                          # cap: rescale so top = cap
                f = cap / mx
                norm = {p: v * f for p, v in norm.items()}
            for p, v in norm.items():
                season[(lg, p)] += v
    return season, q

def show_consensus(scheme, title):
    base, _ = standings(scheme)
    cons, q = consensus_standings(scheme)
    for lg in ("family", "oppenheimer"):
        players = q[lg]
        N = len(players)
        base_rank = {p: i for i, (p, _v) in
                     enumerate(sorted([(p, base[(lg, p)]) for p in players], key=lambda x: -x[1]), 1)}
        rows = sorted([(p, cons[(lg, p)]) for p in players], key=lambda x: -x[1])
        print(f"\n=== {title} — {lg} (N={N}, pool 3N={3*N}/game, cap={N}) ===")
        print(f"  {'#':>2}  {'player':<12} {'points':>7}   {'base#':>5} {'move':>5}")
        for i, (p, v) in enumerate(rows, 1):
            mv = base_rank[p] - i
            arrow = f"+{mv}" if mv > 0 else (str(mv) if mv < 0 else "=")
            print(f"  {i:2d}. {p:<12} {v:7.1f}   {base_rank[p]:5d} {arrow:>5}")


NAMES = {}
for m in fx["matches"]:
    NAMES[str(m["id"])] = ((m.get("home") or {}).get("abbreviation"),
                           (m.get("away") or {}).get("abbreviation"),
                           (m.get("stage") or {}).get("slug"))

def explain_game(lg, mid, scheme, ko_pool_f=3.0, ko_cap_f=1.0):
    q = qualified_sets()[lg]
    N = len(q)
    mt = MATCH[mid]
    pool, cap = pool_cap(mt["ko"], N, ko_pool_f, ko_cap_f)
    gindex = {(r["league"], r["player"], str(r["matchId"])): r for r in ROWS}
    h, a, slug = NAMES[mid]
    res = f"{h} {mt['ah']}-{mt['aa']} {a}"
    if mt["ko"]:
        res += f"  [KO, winner={mt['winner']}, decided_by={mt['decided_by']}]"
    print(f"\n--- game {mid}: {res}  (stage={slug}) ---")
    raw = {}
    for p in q:
        g = gindex.get((lg, p, mid))
        gtxt = f"{g['guessHome']}-{g['guessAway']}" if g else "(no pick)"
        if g and mt["ko"] and g["guessHome"] == g["guessAway"]:
            gtxt += f" pen:{g.get('penaltyWinner') or '-'}"
        raw[p] = score_pick(g, mt, scheme) if g else 0
        raw[p] = (raw[p], gtxt)
    tot = sum(v[0] for v in raw.values())
    print(f"  pool = {pool:g}, cap = {cap:g}, sum(raw) = {tot}")
    if tot <= 0:
        print("  sum(raw)=0 -> everyone gets 0 this game"); return
    norm = {p: raw[p][0] * pool / tot for p in q}
    mx = max(norm.values())
    factor = cap / mx if mx > cap else 1.0
    if factor < 1.0:
        print(f"  cap BINDS: max_norm={mx:.2f} > {cap:g} -> rescale all x{factor:.3f}")
    else:
        print(f"  cap ok: max_norm={mx:.2f} <= {cap:g}")
    print(f"  {'player':<10} {'pick':>10} {'raw':>4} {'share':>7} {'final':>7}")
    for p in sorted(q, key=lambda p: -raw[p][0]):
        final = norm[p] * factor
        print(f"  {p:<10} {raw[p][1]:>10} {raw[p][0]:>4} {norm[p]:7.2f} {final:7.2f}")
    print(f"  total distributed this game: {sum(norm[p]*factor for p in q):.2f}")


def compare_schemes():
    base, _ = standings(BASELINE)
    flat, q = consensus_standings(BASELINE, 3.0, 1.0)
    kow, _ = consensus_standings(BASELINE, 4.0, 4.0 / 3.0)
    for lg in ("family", "oppenheimer"):
        players = q[lg]
        def ranks(d):
            order = sorted(players, key=lambda p: -d[(lg, p)])
            return {p: i for i, p in enumerate(order, 1)}
        br, fr, kr = ranks(base), ranks(flat), ranks(kow)
        rows = sorted(players, key=lambda p: -kow[(lg, p)])
        print(f"\n=== {lg}: KO-weighted consensus (KO pool 4N / cap 4/3 N) ===")
        print(f"  {'#':>2} {'player':<10} {'KOpts':>7}   {'base#':>5} {'flat#':>5} {'KO#':>4}")
        for i, p in enumerate(rows, 1):
            print(f"  {i:2d} {p:<10} {kow[(lg,p)]:7.1f}   {br[p]:5d} {fr[p]:5d} {kr[p]:4d}")


def table_new_vs_current():
    cur, _ = standings(BASELINE)
    new, q = consensus_standings(BASELINE, 4.0, 4.0 / 3.0)   # KO=4 consensus
    for lg in ("family", "oppenheimer"):
        players = q[lg]
        cur_rank = {p: i for i, p in
                    enumerate(sorted(players, key=lambda p: -cur[(lg, p)]), 1)}
        rows = sorted(players, key=lambda p: -new[(lg, p)])
        print(f"\n=== {lg}: NEW (KO=4 consensus) vs CURRENT ===")
        print(f"  {'new#':>4} {'player':<10} {'newPts':>7} {'curPts':>7} {'cur#':>4} {'move':>5}")
        for i, p in enumerate(rows, 1):
            mv = cur_rank[p] - i
            arrow = f"+{mv}" if mv > 0 else (str(mv) if mv < 0 else "=")
            print(f"  {i:4d} {p:<10} {new[(lg,p)]:7.1f} {cur[(lg,p)]:7.0f} {cur_rank[p]:4d} {arrow:>5}")


if __name__ == "__main__":
    scored = sum(1 for r in ROWS if str(r["matchId"]) not in EXCLUDE and str(r["matchId"]) in MATCH)
    print(f"Scored guess-rows: {scored} | matches with results: {len(MATCH)} (excl {sorted(EXCLUDE)})")
    show(BASELINE, "BASELINE (current rules)")
    show_consensus(BASELINE, "CONSENSUS (parimutuel, current weights)")
    print("\n########## THREE-WAY: baseline / flat-consensus / KO-weighted ##########")
    compare_schemes()
    print("\n########## NEW (KO=4 consensus) vs CURRENT ##########")
    table_new_vs_current()
