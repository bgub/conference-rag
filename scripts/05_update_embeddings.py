"""
Step 5: Import Embeddings to Database
=========================================
Reads scripts/output/sentences_with_embeddings.json and imports
embeddings to existing Supabase sentence rows, preserving their IDs.

After this step, SEMANTIC SEARCH will light up green on your site!

Usage:
    python scripts/05_update_embeddings.py

Input:
    scripts/output/sentences_with_embeddings.json  — from Step 4

Prerequisites:
    - config.public.json with Supabase URL and anon key
    - config.secret.json with Supabase service key
    - Database schema created (Step 1)
    - Embeddings generated (Step 4)
"""

import json
import os
import sys

import httpx
from supabase import ClientOptions, create_client
from tqdm import tqdm


INPUT_FILE = os.path.join("scripts", "output", "sentences_with_embeddings.json")
BATCH_SIZE = 50


def load_config():
    with open("config.public.json", "r") as f:
        public_config = json.load(f)
    with open("config.secret.json", "r") as f:
        secrets = json.load(f)
    return public_config, secrets


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ {INPUT_FILE} not found. Run scripts/04_embed_data.py first.")
        sys.exit(1)

    # Load embedded records
    print("Loading embeddings data...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        records = json.load(f)

    # Verify embeddings are present
    with_embeddings = sum(1 for r in records if r.get("embedding"))
    without_embeddings = len(records) - with_embeddings

    print(f"   Loaded {len(records):,} records")
    print(f"   With embeddings:    {with_embeddings:,}")
    if without_embeddings or any(len(r["embedding"]) != 1536 for r in records):
        raise ValueError("Every sentence must have a 1,536-dimensional embedding")

    # Connect to Supabase
    public_config, secrets = load_config()
    # Use HTTP/1.1 for reliable large uploads in this environment.
    client = create_client(
        public_config["SUPABASE_URL"],
        secrets["SUPABASE_SERVICE_KEY"],
        options=ClientOptions(httpx_client=httpx.Client(http2=False, timeout=120)),
    )

    # Match existing rows before any writes. Never delete the imported corpus.
    row_ids = {}
    start = 0
    while True:
        rows = (
            client.table("sentence_embeddings")
            .select("id,talk_id,sentence_num")
            .order("id")
            .range(start, start + 999)
            .execute()
            .data
        )
        for row in rows:
            key = (row["talk_id"], row["sentence_num"])
            if key in row_ids:
                raise ValueError("Duplicate sentences in the database")
            row_ids[key] = row["id"]
        if len(rows) < 1000:
            break
        start += len(rows)
    record_keys = {(r["talk_id"], r["sentence_num"]) for r in records}
    if len(record_keys) != len(records) or record_keys != set(row_ids):
        raise ValueError("Embedding file must match the complete imported corpus")
    for record in records:
        record["id"] = row_ids[(record["talk_id"], record["sentence_num"])]

    # Resume this model's initial backfill without re-uploading completed vectors.
    completed_ids = set()
    start = 0
    while True:
        rows = (
            client.table("sentence_embeddings")
            .select("id")
            .not_.is_("embedding", "null")
            .order("id")
            .range(start, start + 999)
            .execute()
            .data
        )
        completed_ids.update(row["id"] for row in rows)
        if len(rows) < 1000:
            break
        start += len(rows)
    pending = [r for r in records if r["id"] not in completed_ids]
    print(f"   Already uploaded: {len(completed_ids):,}")
    print(
        f"\n   Importing {len(pending):,} remaining records in batches of {BATCH_SIZE}...\n"
    )

    success = 0
    for i in tqdm(range(0, len(pending), BATCH_SIZE), desc="Importing"):
        batch = pending[i : i + BATCH_SIZE]
        try:
            client.table("sentence_embeddings").upsert(
                batch, on_conflict="id", returning="minimal"
            ).execute()
            success += len(batch)
        except Exception as e:
            print(f"\nBatch failed ({type(e).__name__}); retry to resume safely.")
            sys.exit(1)

    print(f"\n✅ Import complete!")
    print(f"   Success: {success:,}")

    # Verify
    result = (
        client.table("sentence_embeddings")
        .select("id", count="exact")
        .limit(1)
        .execute()
    )
    total = result.count or 0

    embedded_result = (
        client.table("sentence_embeddings")
        .select("id", count="exact")
        .not_.is_("embedding", "null")
        .limit(1)
        .execute()
    )
    with_emb = embedded_result.count or 0

    print(f"\n   Total rows:          {total:,}")
    print(f"   Rows with embeddings: {with_emb:,}")
    if total != len(records) or with_emb != len(records):
        raise ValueError("Database embedding count does not match the corpus")

    print(f"\n🎉 Semantic Search is now ready!")
    print(f"   Refresh your site — the 🧠 Semantic Search panel should turn GREEN.")
    print(f"\nNext: Deploy edge functions to light up 🤖 RAG!")


if __name__ == "__main__":
    main()
