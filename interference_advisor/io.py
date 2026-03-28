import json
from typing import List

from .models import CellSnapshot


def load_snapshots(path: str) -> List[CellSnapshot]:
    with open(path, "r", encoding="utf-8") as handle:
        raw = json.load(handle)

    if isinstance(raw, dict) and "snapshots" in raw:
        items = raw["snapshots"]
    else:
        items = raw

    if not isinstance(items, list):
        raise ValueError("Input JSON must be a list or contain 'snapshots' list.")

    return [CellSnapshot.model_validate(item) for item in items]


def save_output(path: str, payload: object) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
