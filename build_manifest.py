"""Rebuild data/projects.json from the findings files in data/<method>/<project>.json."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
MANIFEST = DATA_DIR / "projects.json"


def main(verbose=True):
    entries = [
        {
            "id": f"{path.parent.name}/{path.stem}",
            "label": path.stem,
            "group": path.parent.name,
            "file": path.relative_to(DATA_DIR.parent).as_posix(),
        }
        for path in sorted(DATA_DIR.glob("*/*.json"))
    ]

    MANIFEST.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")

    if not verbose:
        return
    print(f"Wrote {len(entries)} projects to {MANIFEST.relative_to(DATA_DIR.parent).as_posix()}")
    for entry in entries:
        print(f"  {entry['group']}: {entry['label']}")


if __name__ == "__main__":
    main()
