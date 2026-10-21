"""
Step 4: Generate Embeddings
===============================
Reads scripts/output/sentences.json and generates OpenAI embeddings
for each sentence. Saves the result to scripts/output/sentences_with_embeddings.json.

This is the most expensive step (~$0.60 in API costs). The output is
saved to disk so you won't lose your work if the next step fails.

Usage:
    python scripts/04_embed_data.py

Input:
    scripts/output/sentences.json  — from Step 3 (import)

Output:
    scripts/output/sentences_with_embeddings.json  — sentence records with embedding vectors

Prerequisites:
    - config.secret.json with OPENAI_API_KEY
    - scripts/output/sentences.json from the import step
"""

import json
import os
import sys
import time

from openai import OpenAI
from tqdm import tqdm


INPUT_FILE = os.path.join("scripts", "output", "sentences.json")
OUTPUT_FILE = os.path.join("scripts", "output", "sentences_with_embeddings.json")
BATCH_SIZE = 100


def load_secrets():
    with open("config.secret.json", "r") as f:
        return json.load(f)


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ {INPUT_FILE} not found. Run scripts/03_import_data.py first.")
        sys.exit(1)

    # Load sentences
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        records = json.load(f)

    print("=" * 60)
    print(f"Generating Embeddings for {len(records):,} Sentences")
    print("=" * 60)
    print(f"   Model: text-embedding-3-small (1,536 dimensions)")
    print(f"   Batch size: {BATCH_SIZE}\n")

    # Check if there's a partial result we can resume from
    already_embedded = 0
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            existing = json.load(f)
        already_embedded = len(existing)
        for original, embedded in zip(records, existing):
            if any(
                original.get(key) != embedded.get(key)
                for key in ("talk_id", "sentence_num", "text")
            ):
                raise ValueError("Saved embeddings do not match this sentence corpus")
        if already_embedded > len(records) or any(
            len(row.get("embedding", [])) != 1536 for row in existing
        ):
            raise ValueError("Saved embeddings have an invalid count or dimension")
        if already_embedded >= len(records):
            print(
                f"✅ All {len(records):,} sentences already have embeddings in {OUTPUT_FILE}"
            )
            print(f"   Delete {OUTPUT_FILE} to re-generate.")
            return
        print(
            f"   ⏩ Resuming from sentence {already_embedded:,} (found partial output)"
        )
        records_to_embed = records[already_embedded:]
    else:
        existing = []
        records_to_embed = records

    # Generate embeddings
    secrets = load_secrets()
    client = OpenAI(api_key=secrets["OPENAI_API_KEY"])

    embedded_records = list(existing)  # Start from any partial results

    for i in tqdm(range(0, len(records_to_embed), BATCH_SIZE), desc="Embedding"):
        batch = records_to_embed[i : i + BATCH_SIZE]
        batch_texts = [r["text"] for r in batch]

        try:
            response = client.embeddings.create(
                model="text-embedding-3-small", input=batch_texts
            )

            items = sorted(response.data, key=lambda item: item.index)
            if len(items) != len(batch) or any(
                item.index != index or len(item.embedding) != 1536
                for index, item in enumerate(items)
            ):
                raise ValueError("Embedding response does not match the batch")
            for record, item in zip(batch, items):
                record_with_embedding = dict(record)
                record_with_embedding["embedding"] = item.embedding
                embedded_records.append(record_with_embedding)

        except Exception as e:
            # Preserve a contiguous prefix so resuming cannot skip failed sentences.
            temp_file = OUTPUT_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(embedded_records, f, ensure_ascii=False)
            os.replace(temp_file, OUTPUT_FILE)
            print(
                f"\n   ❌ Embedding batch failed ({type(e).__name__}); progress saved. Retry to resume."
            )
            sys.exit(1)

        # Save progress every 10 batches (in case of crash)
        if (i // BATCH_SIZE + 1) % 10 == 0:
            with open(OUTPUT_FILE + ".tmp", "w", encoding="utf-8") as f:
                json.dump(embedded_records, f, ensure_ascii=False)
            os.replace(OUTPUT_FILE + ".tmp", OUTPUT_FILE)

        time.sleep(0.1)

    # Final save
    with open(OUTPUT_FILE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(embedded_records, f, ensure_ascii=False)
    os.replace(OUTPUT_FILE + ".tmp", OUTPUT_FILE)

    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"\n✅ Embedding complete!")
    print(f"   Embedded: {len(embedded_records):,} sentences")

    # Estimate cost
    total_chars = sum(len(r["text"]) for r in embedded_records)
    est_tokens = total_chars / 4  # rough estimate
    cost = (est_tokens / 1_000_000) * 0.020
    print(f"   💰 Estimated cost: ${cost:.4f}")

    print(f"\n💾 Saved to {OUTPUT_FILE} ({file_size_mb:.1f} MB)")
    print(f"   This file is your safety net — embeddings are preserved on disk.")
    print(f"\nNext: python scripts/05_update_embeddings.py")


if __name__ == "__main__":
    main()
