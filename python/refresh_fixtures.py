#!/usr/bin/env python3
"""
Refresh the fixtures end-to-end in one step.

Runs the two scripts in order, each with its defaults:
  1. fetch_fixtures.main()  — pull fixtures from ESPN -> ../data/wc2026_fixtures.json
  2. add_groups.main()      — stamp each group-stage match with its group letter
                              (reads ../data/groups.csv, updates the JSON in place)

Run it from this folder (same as the individual scripts):
    pip install requests
    python refresh_fixtures.py

It always uses the scripts' default paths; to customise (date range, file
locations) run fetch_fixtures.py / add_groups.py individually instead.
"""

import sys

import fetch_fixtures
import add_groups


def main():
    # Both sub-mains parse sys.argv via argparse; blank it so each uses its
    # defaults regardless of how this wrapper was invoked.
    saved_argv = sys.argv
    sys.argv = [saved_argv[0]]
    try:
        print("== 1/2  Fetching fixtures from ESPN ==")
        fetch_fixtures.main()
        print("\n== 2/2  Adding group info ==")
        add_groups.main()
    finally:
        sys.argv = saved_argv
    print("\nDone — fixtures fetched and group letters added.")


if __name__ == "__main__":
    main()
