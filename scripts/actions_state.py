#!/usr/bin/env python3
"""Checks whether GitHub Actions is currently usable for this repo, without
spending any Actions minutes itself (reads run history via the API only).

Why this exists: a sibling project (UTD) hit a real incident where a GitHub
Actions billing/quota block silently stopped every scheduled workflow -
GitHub gives no notification, a blocked run just fails in under 10 seconds
with a billing-related annotation. Nothing here prevents that block (this
repo is public specifically to get unlimited free minutes and avoid the
private-repo quota that caused it), but if it ever gets blocked for a
different reason (spending limit on a paid feature, org-level restriction),
this catches it instead of letting it fail silently.

The blocked signature is specific, not a guess: the most recent run
completed as a failure, took under 10 seconds (i.e. the job never actually
started), and its annotation mentions payment or a spending limit.

Usage:
    python3 scripts/actions_state.py            # update state file
    python3 scripts/actions_state.py --show     # print current state, no check

Requires the GitHub CLI (`gh`) authenticated for this repo.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from typing import Optional

OWNER = os.environ.get("ACTIONS_STATE_OWNER", "camp-tribe-eu")
REPO = os.environ.get("ACTIONS_STATE_REPO", "camp")
STATE_PATH = os.path.expanduser(
    os.environ.get("ACTIONS_STATE_PATH", "~/.config/camptribe/actions_state.json")
)
BILLING_MARKERS = ("recent account payments have failed", "spending limit")
LOOKBACK_H = 24


def sh(cmd: str, timeout: int = 60) -> str:
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    return result.stdout


def blocked_reason() -> Optional[str]:
    """Returns the blocking reason if the most recent run matches the
    billing-block signature, else None. Only looks at recent runs."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=LOOKBACK_H)
    raw = sh(
        f"gh run list --repo {OWNER}/{REPO} --limit 5 "
        f"--json databaseId,status,conclusion,createdAt,updatedAt"
    )
    try:
        runs = json.loads(raw) if raw.strip() else []
    except json.JSONDecodeError:
        return None

    for run in runs:
        created = dt.datetime.fromisoformat(run["createdAt"].replace("Z", "+00:00"))
        if created < cutoff:
            continue
        if run.get("conclusion") != "failure":
            continue
        updated = dt.datetime.fromisoformat(run["updatedAt"].replace("Z", "+00:00"))
        duration_s = (updated - created).total_seconds()
        if duration_s >= 10:
            continue
        annotation = sh(f"gh run view {run['databaseId']} --repo {OWNER}/{REPO}").lower()
        for marker in BILLING_MARKERS:
            if marker in annotation:
                return marker
    return None


def write_state(mode: str, reason: Optional[str]) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(
            {"mode": mode, "reason": reason, "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()},
            f,
            indent=2,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", action="store_true", help="print state without checking")
    args = parser.parse_args()

    if args.show:
        if os.path.exists(STATE_PATH):
            print(open(STATE_PATH).read())
        else:
            print(json.dumps({"mode": "unknown", "reason": "no state file yet"}))
        return

    reason = blocked_reason()
    mode = "local" if reason else "cloud"
    write_state(mode, reason)
    print(f"mode={mode} reason={reason or '-'}")
    if reason:
        sys.exit(1)


if __name__ == "__main__":
    main()
