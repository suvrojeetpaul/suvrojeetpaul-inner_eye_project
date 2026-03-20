#!/usr/bin/env python3
"""Edge-case API checks for nearest beds and emergency endpoints."""

import argparse
import json
import sys
import urllib.error
import urllib.request


def request(base_url: str, path: str, method: str = "GET", body=None, headers=None):
    payload = None
    final_headers = dict(headers or {})
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        final_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=payload,
        method=method,
        headers=final_headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8")
        parsed = {}
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"detail": raw}
        return err.code, parsed


def auth_token(base_url: str, username: str, password: str):
    status, data = request(base_url, "/auth/signup", method="POST", body={"username": username, "password": password})
    if status == 409:
        status, data = request(base_url, "/auth/login", method="POST", body={"username": username, "password": password})
    if status != 200:
        raise RuntimeError(f"Auth failed ({status}): {data}")
    token = data.get("token")
    if not token:
        raise RuntimeError("No token in auth response")
    return token


def check(label: str, ok: bool, detail: str):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}: {detail}")
    return ok


def main():
    parser = argparse.ArgumentParser(description="Run edge-case API checks")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="edgecase_user")
    parser.add_argument("--password", default="EdgeCasePass123")
    args = parser.parse_args()

    results = []

    status, data = request(args.base_url, "/nearest-bed-options?residence=&scope=local")
    results.append(check(
        "missing residence rejected",
        status == 422,
        f"status={status}, detail={data.get('detail')}"
    ))

    status, data = request(args.base_url, "/nearest-bed-options?residence=Kolkata, India&scope=planet")
    results.append(check(
        "invalid scope rejected",
        status == 422,
        f"status={status}, detail={data.get('detail')}"
    ))

    status, data = request(args.base_url, "/nearest-bed-options?residence=Kolkata&scope=local")
    partial_flag = data.get("partial_location_input") if isinstance(data, dict) else None
    results.append(check(
        "partial location accepted with flag",
        status == 200 and partial_flag is True,
        f"status={status}, partial_location_input={partial_flag}"
    ))

    status, data = request(args.base_url, "/nearest-bed-options?residence=NowhereLandZXQ, Unknown&scope=global")
    options = data.get("options") if isinstance(data, dict) else None
    results.append(check(
        "unknown location handled gracefully",
        status == 200 and isinstance(options, list),
        f"status={status}, options_count={len(options or [])}"
    ))

    token = auth_token(args.base_url, args.username, args.password)
    headers = {"Authorization": f"Bearer {token}"}

    status, data = request(args.base_url, "/emergency-nearest-icu", headers=headers)
    options = data.get("options") if isinstance(data, dict) else None
    results.append(check(
        "emergency mode works without location",
        status == 200 and isinstance(options, list),
        f"status={status}, options_count={len(options or [])}"
    ))

    status, data = request(args.base_url, "/ambulance-options?residence=Kolkata, India", headers=headers)
    options = data.get("options") if isinstance(data, dict) else None
    has_eta = bool(options and options[0].get("eta_min") is not None)
    results.append(check(
        "ambulance options include ETA",
        status == 200 and isinstance(options, list) and has_eta,
        f"status={status}, first_eta={options[0].get('eta_min') if options else None}"
    ))

    failed = sum(1 for result in results if not result)
    print(f"\nSummary: {len(results) - failed}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
