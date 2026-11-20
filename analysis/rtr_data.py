"""Load a consistent RTR snapshot into pandas, preserving IDs and NULLs."""
from pathlib import Path
import json
import time

DEFAULT_EXPORTS = Path(__file__).resolve().parents[1] / ".local" / "exports"


def read_manifest(exports_dir=DEFAULT_EXPORTS):
    return json.loads((Path(exports_dir) / "latest.json").read_text(encoding="utf-8"))


def load_dataset(name="active_video_metrics", exports_dir=DEFAULT_EXPORTS, manifest=None):
    import pandas as pd
    exports_dir = Path(exports_dir)
    for attempt in range(3):
        current = manifest if manifest is not None else read_manifest(exports_dir)
        dataset = next((d for d in current["datasets"] if d["name"] == name), None)
        if dataset is None:
            raise ValueError(f"Dataset desconhecido: {name}")
        types = {c["name"]: c["pandas_dtype"] for c in dataset["columns"] if c["pandas_dtype"]}
        try:
            return pd.read_csv(exports_dir / dataset["path"], encoding="utf-8", sep=",",
                               dtype=types, keep_default_na=False,
                               na_values=[current["null_value"]], engine="python")
        except FileNotFoundError:
            if manifest is not None or attempt == 2:
                raise
            time.sleep(0.1)


def load_all(exports_dir=DEFAULT_EXPORTS):
    """All tables refer to the same generation, for consistent joins."""
    for attempt in range(3):
        manifest = read_manifest(exports_dir)
        try:
            return {d["name"]: load_dataset(d["name"], exports_dir, manifest) for d in manifest["datasets"]}
        except FileNotFoundError:
            if attempt == 2:
                raise


if __name__ == "__main__":
    videos = load_dataset()
    print(videos.shape)
    print(videos[["id", "channel_handle", "views", "likes", "duration_seconds"]].head())
