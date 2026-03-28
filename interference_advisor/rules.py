from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import yaml


@dataclass
class RulesConfig:
    thresholds: Dict[str, float] = field(default_factory=dict)
    rule_switches: Dict[str, bool] = field(default_factory=dict)
    weights: Dict[str, Dict[str, float]] = field(default_factory=dict)
    base_confidence: Dict[str, float] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str) -> "RulesConfig":
        with open(path, "r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle) or {}
        return cls(
            thresholds=raw.get("thresholds", {}),
            rule_switches=raw.get("rule_switches", {}),
            weights=raw.get("weights", {}),
            base_confidence=raw.get("base_confidence", {}),
        )
