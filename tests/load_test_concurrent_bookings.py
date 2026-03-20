#!/usr/bin/env python3
"""Simple concurrent booking load test for the DISHA backend.

This script stresses /book-bed with many concurrent requests and prints
latency + status distribution (including expected 409 no-bed responses).
"""

import argparse
import json
import random
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import mean, median

HOSPITALS = [
    "DISHA Central Care",
    "GreenLife Oncology Centre",
    "Sunrise Neuro Institute",
    "Eastern Lung and Chest Hospital",
    "Riverfront Multispeciality",
    "St Thomas Medical Center",
    "North River Cancer Hospital",
    "Pacific Hope Institute",
    "Maple Leaf Oncology",
    "Berlin Unity Klinikum",
    "Paris Lumiere Sante",
    "Harborline Medical Hub",
    "Tokyo Frontier Hospital",
    "Marina Bay Cancer Centre",
    "Emirates Specialist Hospital",
]

LOCATIONS = [
    "Kolkata, India",
    "Howrah, India",
    "London, United Kingdom",
    "New York, United States",
    "Berlin, Germany",
]


class HttpClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request(self, path: str, method: str = "GET", body=None, headers=None):
        payload = None
        final_headers = dict(headers or {})
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            final_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=payload,
            method=method,
            headers=final_headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read().decode("utf-8")
                return resp.status, json.loads(data) if data else {}
        except urllib.error.HTTPError as err:
            body_data = err.read().decode("utf-8")
            parsed = {}
            if body_data:
                try:
                    parsed = json.loads(body_data)
                except json.JSONDecodeError:
                    parsed = {"detail": body_data}
            return err.code, parsed


def create_user_and_get_token(client: HttpClient, username: str, password: str):
    status, data = client.request(
        "/auth/signup",
        method="POST",
        body={"username": username, "password": password},
    )
    if status == 409:
        status, data = client.request(
            "/auth/login",
            method="POST",
            body={"username": username, "password": password},
        )
    if status != 200:
        raise RuntimeError(f"Auth failed ({status}): {data}")
    token = data.get("token")
    if not token:
        raise RuntimeError(f"Missing token in auth response: {data}")
    return token


def run_booking(client: HttpClient, idx: int, token: str, patient_prefix: str):
    start = time.perf_counter()
    hospital = random.choice(HOSPITALS)
    payload = {
        "patient_name": f"{patient_prefix}_{idx}",
        "bed_number": f"BED-{1000 + idx}",
        "residence": random.choice(LOCATIONS),
        "hospital": hospital,
        "consent": True,
    }
    status, data = client.request(
        "/book-bed",
        method="POST",
        body=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    detail = data.get("detail") if isinstance(data, dict) else None
    return status, elapsed_ms, detail


def percentile(values, p):
    if not values:
        return 0.0
    sorted_values = sorted(values)
    rank = max(0, min(len(sorted_values) - 1, int(round((p / 100.0) * (len(sorted_values) - 1)))))
    return sorted_values[rank]


def main():
    parser = argparse.ArgumentParser(description="Run concurrent booking load test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--requests", type=int, default=1000, help="Total booking requests")
    parser.add_argument("--concurrency", type=int, default=120, help="Parallel workers")
    parser.add_argument("--username", default="loadtest_user", help="Auth username")
    parser.add_argument("--password", default="LoadTestPass123", help="Auth password")
    args = parser.parse_args()

    if args.requests < 1:
        raise SystemExit("--requests must be >= 1")
    if args.concurrency < 1:
        raise SystemExit("--concurrency must be >= 1")

    client = HttpClient(args.base_url)
    token = create_user_and_get_token(client, args.username, args.password)

    lock = threading.Lock()
    latency_ms = []
    status_counts = {}
    detail_counts = {}

    test_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(run_booking, client, i, token, "LT") for i in range(args.requests)]
        for future in as_completed(futures):
            status, elapsed, detail = future.result()
            with lock:
                latency_ms.append(elapsed)
                status_counts[status] = status_counts.get(status, 0) + 1
                if detail:
                    detail_counts[detail] = detail_counts.get(detail, 0) + 1

    total_s = time.perf_counter() - test_start
    rps = args.requests / total_s if total_s > 0 else 0

    print("\n=== Concurrent Booking Load Test ===")
    print(f"Base URL:        {args.base_url}")
    print(f"Requests:        {args.requests}")
    print(f"Concurrency:     {args.concurrency}")
    print(f"Duration (sec):  {total_s:.2f}")
    print(f"Throughput RPS:  {rps:.2f}")
    print(f"Latency avg ms:  {mean(latency_ms):.2f}")
    print(f"Latency med ms:  {median(latency_ms):.2f}")
    print(f"Latency p95 ms:  {percentile(latency_ms, 95):.2f}")
    print(f"Latency p99 ms:  {percentile(latency_ms, 99):.2f}")
    print("Status counts:")
    for status in sorted(status_counts):
        print(f"  {status}: {status_counts[status]}")

    if detail_counts:
        print("Top response details:")
        top_details = sorted(detail_counts.items(), key=lambda item: item[1], reverse=True)[:8]
        for detail, count in top_details:
            print(f"  {detail}: {count}")


if __name__ == "__main__":
    main()
