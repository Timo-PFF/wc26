#!/usr/bin/env python3
"""Smoke test for the v2 Worker (worker_v2.js) against a LOCAL wrangler dev server.

Prereqs (run from cloudflare/, in WSL):
  npx wrangler d1 execute wc26 --local --config wrangler.v2.toml --file=schema_v2.sql
  npx wrangler d1 execute wc26 --local --config wrangler.v2.toml --file=seed/seed_v2.sql
  npx wrangler dev --config wrangler.v2.toml --port 8788
Then (fresh shell):  py -3 test_v2.py     (override host with BASE=... if needed)

Exercises the full contract: public league/member lists, register/login/resume,
changePassword, join (wrong + correct code), myLeagues, privacy-filtered guesses
read (empty for the archived tournament), and lock-enforced save. Re-run after a
re-seed for a clean slate (fixed test-user name → name_taken on repeats).
"""
import json, os, sys, urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:8788")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "..", "cloudflare", "seed")
TID = "wc2026"
NAME = "SmokeTest_v2"
LOCKED_MATCH = "760517"  # the (finished) final — any save for it must be rejected

# family join code, read from the local seed dump
lj = json.load(open(os.path.join(SEED, "leagues.json"), encoding="utf-8"))
lrows = lj[0]["results"] if isinstance(lj, list) else lj["results"]
FAMILY_CODE = next((r["password"] for r in lrows if str(r["id"]).strip().lower() == "family"), None)


def get(qs):
    with urllib.request.urlopen(BASE + "/?" + qs) as r:
        return json.load(r)


def post(obj):
    req = urllib.request.Request(BASE + "/", data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


passed = failed = 0
def check(name, cond, resp=None):
    global passed, failed
    ok = bool(cond)
    passed += ok; failed += (not ok)
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   -> {resp}"))


r = get(f"action=leagues&t={TID}")
ids = [l["id"] for l in r.get("leagues", [])]
check("GET leagues has family + oppenheimer", "family" in ids and "oppenheimer" in ids, r)

r = get(f"action=members&t={TID}&league=family")
FAMILY_MEMBERS = set(r.get("members", []))
check("GET members family non-empty", len(FAMILY_MEMBERS) > 0, r)

r = post({"action": "register", "name": NAME, "password": "pw1"})
check("register ok (or name_taken on re-run)", r.get("ok") or r.get("error") == "name_taken", r)
if not r.get("ok"):
    r = post({"action": "login", "name": NAME, "password": "pw2"})  # prior run left it at pw2
token = r.get("token")
check("have a token", bool(token), r)

r = post({"action": "resume", "token": token})
check("resume ok, right name", r.get("ok") and r.get("name") == NAME, r)
token = r.get("token", token)

r = post({"action": "changePassword", "token": token, "oldPassword": "pw1", "newPassword": "pw2"})
check("changePassword ok (or already pw2)", r.get("ok") or r.get("error") == "bad_password", r)

r = post({"action": "login", "name": NAME, "password": "pw2"})
check("login with new password", r.get("ok"), r)
token = r.get("token", token)

r = post({"action": "myLeagues", "token": token, "tournamentId": TID})
check("myLeagues before join ok", r.get("ok"), r)

# wrong code against a league the smoke user is NOT in (family may already be joined
# from a prior run, which would short-circuit to already:true before the code check).
r = post({"action": "joinLeague", "token": token, "tournamentId": TID, "leagueId": "oppenheimer", "joinCode": "nope"})
check("join with wrong code rejected", r.get("error") == "bad_join_code", r)

r = post({"action": "joinLeague", "token": token, "tournamentId": TID, "leagueId": "family", "joinCode": FAMILY_CODE})
check("join with correct code", r.get("ok"), r)

r = post({"action": "myLeagues", "token": token, "tournamentId": TID})
check("myLeagues has family after join", any(l["id"] == "family" for l in r.get("leagues", [])), r)

# Until the regenerated snapshot is on main, the late knockout games read as active
# and return every family member's (locked) pick — which validates league scoping +
# the locked-games privacy filter. Once the fresh snapshot is pushed, this is [].
r = post({"action": "guesses", "token": token, "tournamentId": TID, "leagueId": "family"})
gplayers = {g["player"] for g in r.get("guesses", [])}
check("guesses ok + scoped to family members", r.get("ok") and gplayers.issubset(FAMILY_MEMBERS), r)

r = post({"token": token, "tournamentId": TID, "guesses": [{"matchId": LOCKED_MATCH, "home": 1, "away": 0}]})
check("save of a locked game is rejected", r.get("ok") and r.get("saved") == 0 and r.get("rejected") == 1, r)

r = post({"action": "register", "name": NAME, "password": "x"})
check("duplicate register -> name_taken", r.get("error") == "name_taken", r)

r = post({"action": "login", "name": NAME, "password": "wrong"})
check("wrong password -> bad_password", r.get("error") == "bad_password", r)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
