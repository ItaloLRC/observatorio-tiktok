"""Optional: python analysis/to_parquet.py --watch (requires pandas and pyarrow)."""
from pathlib import Path
import argparse
import json
import os
import time
from rtr_data import DEFAULT_EXPORTS, load_dataset, read_manifest


def convert(exports_dir, output_dir, manifest):
    import pyarrow  # Check the optional dependency before writing anything.
    output_dir.mkdir(parents=True, exist_ok=True)
    generation_dir = output_dir / "snapshots" / manifest["generation"]
    generation_dir.mkdir(parents=True, exist_ok=True)
    for dataset in manifest["datasets"]:
        frame = load_dataset(dataset["name"], exports_dir, manifest)
        temporary = generation_dir / (dataset["name"] + ".parquet.tmp")
        frame.to_parquet(temporary, engine="pyarrow", index=False)
        os.replace(temporary, generation_dir / (dataset["name"] + ".parquet"))
    result = {"generation": manifest["generation"], "source_exported_at": manifest["exported_at"],
              "datasets": [{"name": d["name"], "path": f"snapshots/{manifest['generation']}/{d['name']}.parquet", "rows": d["rows"]} for d in manifest["datasets"]]}
    temporary = output_dir / ".latest.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, output_dir / "latest.json")
    print(f"Parquet atualizado: {manifest['generation']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--exports-dir", type=Path, default=DEFAULT_EXPORTS)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--interval", type=float, default=5)
    args = parser.parse_args()
    output = args.output_dir or args.exports_dir / "parquet"
    last = None
    while True:
        try:
            manifest = read_manifest(args.exports_dir)
            if manifest["generation"] != last:
                convert(args.exports_dir, output, manifest)
                last = manifest["generation"]
        except (FileNotFoundError, PermissionError, ValueError) as error:
            if not args.watch:
                raise
            print(f"Aguardando próxima leitura: {error}", flush=True)
        if not args.watch:
            break
        time.sleep(max(1, args.interval))


if __name__ == "__main__":
    main()
