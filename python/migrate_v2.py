#!/usr/bin/env python3
"""Migrate the WC2026 (league, name)-scoped D1 to the v2 global-users schema.

Reads FRESH JSON dumps of the live D1 (leagues/players/links/guesses — see the
export commands below) and produces the v2 rows:
  players + links   -> users (link groups collapsed) + memberships
  leagues           -> leagues (tournamentId = 'wc2026')
  guesses (mirrored)-> one set per (userId, 'wc2026', matchId)

DRY-RUN: recomputes the per-league standings from BOTH the old structure and the
migrated v2 structure and asserts they match — proving the re-key loses nothing.
Also flags name collisions + per-league password mismatches for merged users.

Writes cloudflare/seed/seed_v2.sql (gitignored) when the dry-run passes.
Run: py -3 migrate_v2.py
"""
import json, os
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "..", "cloudflare", "seed")
DATA = os.path.join(HERE, "..", "data", "wc2026")
TID = "wc2026"                              # primary tournament (drives the dry-run validation)
SEED_TIDS = ["wc2026", "test_tournament"]   # tournaments to seed — both share wc2026's global
                                            # users + data (test_tournament = alternate scoring)
# tid -> the tid its leagues inherit (same league ids). A member of the inherited
# league may join the inheriting league code-free. test_tournament inherits wc2026.
INHERITS = {"test_tournament": "wc2026"}
# Empty tournaments seeded with LEAGUES ONLY (no members/guesses) — people join via
# inheritance. tid -> the tid it inherits (same league ids). euro2024 = framework test.
LEAGUES_ONLY = {"euro2024": "wc2026"}

def norm(s): return str(s or "").strip().lower()

def load_export(path, cols):
    """Read a `wrangler d1 execute --json` dump into {col: value} dicts. Values kept
    as-is (INTEGER guess scores stay ints); NULL -> ''."""
    raw = json.load(open(path, encoding="utf-8"))
    rows = raw[0]["results"] if isinstance(raw, list) else raw.get("results", raw)
    return [{c: ("" if r.get(c) is None else r.get(c)) for c in cols} for r in rows]

# ---- load source: FRESH exports of the LIVE D1. Run from cloudflare/ FIRST:
#   npx wrangler d1 execute wc26 --remote --command "SELECT id,name,password FROM leagues" --json > seed/leagues.json
#   npx wrangler d1 execute wc26 --remote --command "SELECT league,name,passHash FROM players" --json > seed/players.json
#   npx wrangler d1 execute wc26 --remote --command "SELECT linkId,league,name FROM links" --json > seed/links.json
#   npx wrangler d1 execute wc26 --remote --command "SELECT league,player,matchId,guessHome,guessAway,penaltyWinner FROM guesses" --json > seed/guesses.json
leagues = load_export(os.path.join(SEED, "leagues.json"), ["id", "name", "password"])
players = load_export(os.path.join(SEED, "players.json"), ["league", "name", "passHash"])
links   = load_export(os.path.join(SEED, "links.json"), ["linkId", "league", "name"])
grows   = load_export(os.path.join(SEED, "guesses.json"), ["league", "player", "matchId", "guessHome", "guessAway", "penaltyWinner"])
fx = json.load(open(os.path.join(DATA, "wc2026_fixtures.json"), encoding="utf-8"))

players = [p for p in players if p["league"].strip() and p["name"].strip()]
PKEY = lambda lg, nm: (norm(lg), norm(nm))                 # player identity key
pmap = {PKEY(p["league"], p["name"]): p for p in players}  # key -> player row

# ---- union player rows that share a linkId -> one user --------------------
parent = {}
def find(x):
    parent.setdefault(x, x)
    root = x
    while parent[root] != root: root = parent[root]
    while parent[x] != root: parent[x], x = root, parent[x]
    return root
def union(a, b):
    parent[find(a)] = find(b)

for k in pmap: find(k)                                       # every player is its own set
by_link = defaultdict(list)
for r in links:
    k = PKEY(r["league"], r["name"])
    if k in pmap: by_link[r["linkId"]].append(k)
for grp in by_link.values():
    for k in grp[1:]:
        union(grp[0], k)

comps = defaultdict(list)                                    # root -> [player keys]
for k in pmap: comps[find(k)].append(k)

# ---- build users + flag issues --------------------------------------------
warnings = []
users = []            # {id, name, passHash, keys:[player keys]}
for root, keys in comps.items():
    names = [pmap[k]["name"].strip() for k in keys]
    hashes = {pmap[k]["passHash"].strip() for k in keys}
    display = Counter(names).most_common(1)[0][0]
    if len(set(norm(n) for n in names)) > 1:
        warnings.append(f"merged user has differing names {sorted(set(names))} -> using '{display}'")
    if len(hashes) > 1:
        warnings.append(f"user '{display}' has differing passwords across leagues -> using one")
    users.append({"name": display, "passHash": sorted(hashes)[0], "keys": keys})

users.sort(key=lambda u: norm(u["name"]))
seen = {}
for i, u in enumerate(users, 1):
    u["id"] = "u%03d" % i
    if norm(u["name"]) in seen:
        warnings.append(f"NAME COLLISION: '{u['name']}' (unlinked duplicate) — resolve before real run")
    seen[norm(u["name"])] = u["id"]

key2user = {k: u for u in users for k in u["keys"]}          # player key -> user

# ---- memberships + de-mirrored guesses ------------------------------------
memberships = [(u["id"], TID, norm(lg))
               for u in users for (lg, nm) in u["keys"]]

# gather each user's guesses (union across their leagues; they mirror, so dedup by match)
user_g = defaultdict(dict)   # userId -> {matchId: (h,a,pen)}
conflicts = 0
for g in grows:
    k = PKEY(g["league"], g["player"])
    u = key2user.get(k)
    if not u: continue
    mid = str(g["matchId"])
    val = (g["guessHome"], g["guessAway"], (g.get("penaltyWinner") or ""))
    prev = user_g[u["id"]].get(mid)
    if prev is not None and prev != val:
        conflicts += 1
    user_g[u["id"]][mid] = val

# ---- scoring (standard) for the dry-run -----------------------------------
MATCH = {}
for m in fx["matches"]:
    if not (m.get("status") or {}).get("completed"): continue
    MATCH[str(m["id"])] = (bool((m.get("stage") or {}).get("knockout")),
                           m["home"]["score"], m["away"]["score"],
                           m.get("winner"), m.get("decidedBy") or "regulation")

def score(gh, ga, pen, m):
    ko, ah, aa, adv, dec = m
    if not ko:
        if gh == ah and ga == aa: return 3
        go, ao = (gh > ga) - (gh < ga), (ah > aa) - (ah < aa)
        if go != ao: return 0
        if go == 0: return 1
        return 2 if (gh - ga) == (ah - aa) else 1
    pens = dec == "penalties"; exact = gh == ah and ga == aa
    if gh != ga:
        pred = "home" if gh > ga else "away"
        if pens: return 1 if pred == adv else 0
        if pred != adv: return 0
        if exact: return 4
        return 3 if (gh - ga) == (ah - aa) else 2
    if not pens: return 1 if pen == adv else 0
    return 2 + (1 if exact else 0) + (1 if pen == adv else 0)

# OLD standings: guesses grouped by (league, player)
old = defaultdict(lambda: defaultdict(int))
for g in grows:
    mid = str(g["matchId"])
    if mid not in MATCH: continue
    old[norm(g["league"])][g["player"].strip()] += score(g["guessHome"], g["guessAway"], g.get("penaltyWinner") or "", MATCH[mid])

# NEW standings: memberships x user guesses
umap = {u["id"]: u for u in users}
mem_by_league = defaultdict(list)
for uid, tid, lg in memberships: mem_by_league[lg].append(uid)
new = defaultdict(lambda: defaultdict(int))
for lg, uids in mem_by_league.items():
    for uid in uids:
        pts = sum(score(h, a, p, MATCH[mid]) for mid, (h, a, p) in user_g[uid].items() if mid in MATCH)
        new[lg][umap[uid]["name"]] += pts

# ---- report ---------------------------------------------------------------
print(f"users: {len(users)} | memberships: {len(memberships)} | leagues: {len(leagues)} | "
      f"guess-rows(v2): {sum(len(v) for v in user_g.values())} | guess conflicts: {conflicts}")
ok = True
for lg in sorted(set(list(old) + list(new))):
    o, n = dict(old[lg]), dict(new[lg])
    match = o == n
    ok = ok and match
    print(f"  league {lg}: standings match = {match}  ({len(o)} old / {len(n)} new players)")
    if not match:
        for name in sorted(set(list(o) + list(n))):
            if o.get(name) != n.get(name):
                print(f"     MISMATCH {name}: old={o.get(name)} new={n.get(name)}")
print("WARNINGS:" if warnings else "no warnings.")
for w in warnings: print("  -", w)

# ---- emit seed_v2.sql (only if the dry-run passed) ------------------------
if ok and not any("COLLISION" in w for w in warnings):
    q = lambda v: "'" + str(v).replace("'", "''") + "'"
    out = ["-- GENERATED by migrate_v2.py — do not commit (password hashes).", ""]
    for tbl in ("guesses", "memberships", "leagues", "users"):
        out.append(f"DELETE FROM {tbl};")
    out.append("")
    # users are GLOBAL (shared across tournaments) — emit once.
    for u in users:
        out.append(f"INSERT INTO users (id,name,passHash,created) VALUES ({q(u['id'])},{q(u['name'])},{q(u['passHash'])},{q('2026-migrated')});")
    # leagues / memberships / guesses are per-tournament — emit for each target tid.
    for tid in SEED_TIDS:
        out.append("")
        inh = INHERITS.get(tid)   # inherit the SAME league id from the parent tournament
        for l in leagues:
            if not l["id"].strip(): continue
            lid = norm(l["id"])
            it = q(inh) if inh else "NULL"
            il = q(lid) if inh else "NULL"
            out.append(f"INSERT INTO leagues (tournamentId,id,name,password,inheritsTournamentId,inheritsLeagueId) VALUES ({q(tid)},{q(lid)},{q(l['name'])},{q(l['password'])},{it},{il});")
        for u in users:
            for (lg, nm) in u["keys"]:
                out.append(f"INSERT INTO memberships (userId,tournamentId,leagueId) VALUES ({q(u['id'])},{q(tid)},{q(norm(lg))});")
        for uid, gs in user_g.items():
            for mid, (h, a, p) in gs.items():
                hh = "NULL" if h in (None, "") else int(h)
                aa = "NULL" if a in (None, "") else int(a)
                out.append(f"INSERT INTO guesses (userId,tournamentId,matchId,guessHome,guessAway,penaltyWinner,ts) VALUES ({q(uid)},{q(tid)},{q(mid)},{hh},{aa},{q(p)},{q('2026-migrated')});")
    # Leagues-only (empty) tournaments — inheriting leagues, no members/guesses.
    for tid, inh in LEAGUES_ONLY.items():
        out.append("")
        for l in leagues:
            if not l["id"].strip(): continue
            lid = norm(l["id"])
            out.append(f"INSERT INTO leagues (tournamentId,id,name,password,inheritsTournamentId,inheritsLeagueId) VALUES ({q(tid)},{q(lid)},{q(l['name'])},{q(l['password'])},{q(inh)},{q(lid)});")
    open(os.path.join(SEED, "seed_v2.sql"), "w", encoding="utf-8").write("\n".join(out) + "\n")
    print(f"\nWrote {SEED}/seed_v2.sql  (data: {', '.join(SEED_TIDS)} | leagues-only: {', '.join(LEAGUES_ONLY)})")

    # ---- regenerate the finished-guesses snapshot (PER-PLAYER, from v2 data) ----
    # Picks are global (per user), so the snapshot is one row per (player, match) —
    # no league column. The frontend filters it to the current league's members, so a
    # user's picks show in every league they're in, with no duplication. Written to
    # gitignored staging; the cutover copies it to data/wc2026/ (+ test_tournament).
    snap_rows = []
    for u in users:
        for mid, (h, a, p) in user_g[u["id"]].items():
            if mid in MATCH:                            # completed games only
                snap_rows.append((u["name"], mid, int(h), int(a), p))
    snap = ["player,matchId,home,away,penaltyWinner"]
    for nm, mid, h, a, p in sorted(snap_rows, key=lambda r: (r[0].lower(), int(r[1]))):
        snap.append(f"{nm},{mid},{h},{a},{p}")
    snap_path = os.path.join(SEED, "wc2026_historical_guesses.csv")
    open(snap_path, "w", encoding="utf-8", newline="\n").write("\n".join(snap) + "\n")
    print(f"Wrote {snap_path} ({len(snap_rows)} rows, {len(set(r[1] for r in snap_rows))} finished matches)")
else:
    print("\nDry-run did NOT pass cleanly — seed_v2.sql not written.")
