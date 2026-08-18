#!/usr/bin/env python3
"""Query and safely update the browser file-upload site profile registry."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_DB = Path(__file__).resolve().parent.parent / "references" / "site-profiles.json"
VALID_STATUS = {"verified", "observed", "hypothesis", "stale"}
VALID_CONTROL_TYPES = {
    "native-visible-input",
    "label-for-input",
    "hidden-input-wrapped-trigger",
    "custom-trigger-filechooser",
    "drag-drop-zone",
    "rich-editor-attachment",
    "iframe-contained",
    "shadow-dom-contained",
    "cloud-picker",
    "mobile-system-picker",
}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_profile(profile: dict) -> list[str]:
    errors: list[str] = []
    required = [
        "site_id",
        "site_name",
        "domains",
        "route_patterns",
        "control_type",
        "status",
        "activation",
        "verification",
        "last_verified",
    ]
    for key in required:
        if key not in profile:
            errors.append(f"missing required key: {key}")

    site_id = profile.get("site_id")
    if not isinstance(site_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", site_id):
        errors.append("site_id must use lowercase letters, digits, and hyphens")
    if not isinstance(profile.get("domains"), list) or not profile.get("domains"):
        errors.append("domains must be a non-empty list")
    if not isinstance(profile.get("route_patterns"), list):
        errors.append("route_patterns must be a list")
    if profile.get("status") not in VALID_STATUS:
        errors.append(f"status must be one of {sorted(VALID_STATUS)}")
    if profile.get("control_type") not in VALID_CONTROL_TYPES:
        errors.append(f"control_type must be one of {sorted(VALID_CONTROL_TYPES)}")
    if not isinstance(profile.get("activation"), dict):
        errors.append("activation must be an object")
    if not isinstance(profile.get("verification"), list) or not profile.get("verification"):
        errors.append("verification must be a non-empty list")
    date_value = profile.get("last_verified")
    if date_value is not None and (
        not isinstance(date_value, str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_value)
    ):
        errors.append("last_verified must be YYYY-MM-DD or null")
    return errors


def validate_db(db: dict) -> list[str]:
    errors: list[str] = []
    if db.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    profiles = db.get("profiles")
    if not isinstance(profiles, list):
        return errors + ["profiles must be a list"]
    seen: set[str] = set()
    for index, profile in enumerate(profiles):
        if not isinstance(profile, dict):
            errors.append(f"profiles[{index}] must be an object")
            continue
        profile_errors = validate_profile(profile)
        errors.extend(f"profiles[{index}]: {item}" for item in profile_errors)
        site_id = profile.get("site_id")
        if site_id in seen:
            errors.append(f"duplicate site_id: {site_id}")
        if isinstance(site_id, str):
            seen.add(site_id)
    return errors


def write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def print_json(value) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def command_list(db: dict) -> int:
    rows = [
        {
            "site_id": p["site_id"],
            "site_name": p["site_name"],
            "domains": p["domains"],
            "control_type": p["control_type"],
            "status": p["status"],
            "last_verified": p["last_verified"],
        }
        for p in db["profiles"]
    ]
    print_json(rows)
    return 0


def command_find(db: dict, url: str) -> int:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path or "/"
    matches = []
    for profile in db["profiles"]:
        domains = {item.lower() for item in profile["domains"]}
        routes = profile.get("route_patterns", [])
        if domain in domains and (not routes or any(route in path for route in routes)):
            matches.append(profile)
    print_json(matches)
    return 0 if matches else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list")
    subparsers.add_parser("validate")
    get_parser = subparsers.add_parser("get")
    get_parser.add_argument("--site-id", required=True)
    find_parser = subparsers.add_parser("find")
    find_parser.add_argument("--url", required=True)
    upsert_parser = subparsers.add_parser("upsert")
    upsert_parser.add_argument("--profile", type=Path, required=True)
    upsert_parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = load_json(args.db)
    db_errors = validate_db(db)
    if db_errors:
        print_json({"ok": False, "errors": db_errors})
        return 2

    if args.command == "validate":
        print_json({"ok": True, "profiles": len(db["profiles"])})
        return 0
    if args.command == "list":
        return command_list(db)
    if args.command == "get":
        match = next((p for p in db["profiles"] if p["site_id"] == args.site_id), None)
        print_json(match or {})
        return 0 if match else 1
    if args.command == "find":
        return command_find(db, args.url)

    profile = load_json(args.profile)
    errors = validate_profile(profile)
    if errors:
        print_json({"ok": False, "errors": errors})
        return 2
    index = next(
        (i for i, item in enumerate(db["profiles"]) if item["site_id"] == profile["site_id"]),
        None,
    )
    action = "update" if index is not None else "insert"
    if index is None:
        db["profiles"].append(profile)
    else:
        db["profiles"][index] = profile
    db["profiles"].sort(key=lambda item: item["site_id"])
    final_errors = validate_db(db)
    if final_errors:
        print_json({"ok": False, "errors": final_errors})
        return 2
    if not args.dry_run:
        write_atomic(args.db, db)
    print_json({"ok": True, "action": action, "dry_run": args.dry_run, "site_id": profile["site_id"]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
