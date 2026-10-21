"""Alternative to steps 04/05: generate missing vectors inside Supabase.

Requires the admin-only embed-corpus function and its OPENAI_API_KEY secret.
Only small progress responses travel through this machine.
"""

import json
import time
from pathlib import Path

import requests


def main():
    public = json.loads(Path("config.public.json").read_text())
    secrets = json.loads(Path("config.secret.json").read_text())
    url = public["SUPABASE_URL"] + "/functions/v1/embed-corpus"
    headers = {"apikey": secrets["SUPABASE_SERVICE_KEY"]}
    embedded = 0
    with requests.Session() as session:
        for batch in range(1, 1001):
            for attempt in range(3):
                response = session.post(url, headers=headers, json={}, timeout=180)
                if response.ok or response.status_code < 500 or attempt == 2:
                    break
                time.sleep(2**attempt)
            if not response.ok:
                raise RuntimeError(
                    f"Backfill failed: {response.status_code} {response.text[:200]}"
                )
            count = response.json()["embedded"]
            if count == 0:
                print("Complete: no sentences are missing embeddings.", flush=True)
                return
            embedded += count
            print(
                f"Batch {batch}: {count} vectors; {embedded:,} completed in this run.",
                flush=True,
            )
    raise RuntimeError("Backfill batch limit reached; rerun to continue")


if __name__ == "__main__":
    main()
