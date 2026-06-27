"""
Download the GAIA validation split from HuggingFace and save it as
scripts/data/gaia_validation.json so the TypeScript harness can load it.

Requirements:
    pip install datasets huggingface_hub

Steps:
    1. Create a HuggingFace account at https://huggingface.co
    2. Accept the GAIA dataset terms at:
       https://huggingface.co/datasets/gaia-benchmark/GAIA
    3. Run:  python3 scripts/download-gaia.py
       (will prompt for your HF token on first run, or set HF_TOKEN env var)
"""

import json
import os
import sys
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent / "data" / "gaia_validation.json"


def main():
    try:
        from datasets import load_dataset
    except ImportError:
        print("ERROR: 'datasets' package not found.")
        print("Install it with:  pip install datasets huggingface_hub")
        sys.exit(1)

    hf_token = os.environ.get("HF_TOKEN")

    print("Downloading GAIA 2023_all validation split from HuggingFace...")
    print("(This requires accepting dataset terms at https://huggingface.co/datasets/gaia-benchmark/GAIA)\n")

    try:
        ds = load_dataset(
            "gaia-benchmark/GAIA",
            "2023_all",
            trust_remote_code=True,
            token=hf_token,
        )
    except Exception as e:
        print(f"ERROR downloading dataset: {e}")
        print("\nMake sure you have:")
        print("  1. Accepted the dataset terms on HuggingFace")
        print("  2. Set HF_TOKEN env var, or run `huggingface-cli login` first")
        sys.exit(1)

    validation = list(ds["validation"])

    # Flatten annotator metadata into plain strings for JSON serialisation
    records = []
    for item in validation:
        record = dict(item)
        meta = record.get("Annotator Metadata")
        if meta and not isinstance(meta, dict):
            # Some versions surface it as a nested object
            try:
                record["Annotator_Metadata"] = dict(meta)
            except Exception:
                record["Annotator_Metadata"] = str(meta)
            del record["Annotator Metadata"]
        records.append(record)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    # Print breakdown by level
    by_level: dict[int, int] = {}
    for r in records:
        lvl = r.get("Level", 0)
        by_level[lvl] = by_level.get(lvl, 0) + 1

    print(f"Saved {len(records)} questions to {OUTPUT_PATH}")
    print("\nBreakdown by level:")
    for lvl in sorted(by_level):
        print(f"  Level {lvl}: {by_level[lvl]} questions")
    print("\nYou can now run:  npm run bench:gaia")


if __name__ == "__main__":
    main()
