
from __future__ import annotations

from typing import List

from .models import (
    ActionStep,
    AdvisoryOutput,
    AffectationSummary,
    CellSnapshot,
    ConfigChange,
    ExpectedEffect,
    Recommendation,
    RollbackPlan,
    SpectrogramEvidence,
)
from .rules import RulesConfig


def _get_threshold(rules: RulesConfig, key: str, default: float) -> float:
    return float(rules.thresholds.get(key, default))


def _rule_enabled(rules: RulesConfig, key: str) -> bool:
    return bool(rules.rule_switches.get(key, True))


def _confidence(
    rules: RulesConfig,
    category: str,
    hard_trigger: bool,
    score: float,
) -> float:
    base = rules.base_confidence.get("hard" if hard_trigger else "soft", 0.35)
    weights = rules.weights.get(category, {})
    max_score = sum(weights.values()) or 1.0
    normalized = min(score / max_score, 1.0)
    return min(base + normalized * 0.5, 1.0)


def _severity(
    snapshot: CellSnapshot, hard: bool, extra_high: bool = False
) -> str:
    if extra_high or hard:
        return "high"
    if snapshot.ul_sinr_db_p10 is not None and snapshot.ul_sinr_db_p10 < -6:
        return "high"
    if snapshot.ul_sinr_db_p50 is not None and snapshot.ul_sinr_db_p50 < -3:
        return "med"
    return "low"


def _evidence_line(label: str, value: object) -> str:
    return f"{label}: {value}"


def _common_verify_kpis() -> List[str]:
    return [
        "ul_sinr_db_p10",
        "pusch_bler",
        "pucch_bler_avg",
        "harq_dtx_rate",
        "harq_nack_rate",
        "ul_thp_mbps",
    ]


def _make_action(
    title: str,
    feature_id: str | None = None,
    config_changes: List[ConfigChange] | None = None,
    prerequisites: List[str] | None = None,
    conflicts: List[str] | None = None,
    expected_effect: List[ExpectedEffect] | None = None,
    verify_with: List[str] | None = None,
    rollback: str | None = None,
    reason_codes: List[str] | None = None,
    ) -> ActionStep:
    return ActionStep(
        title=title,
        feature_id=feature_id,
        config_changes=config_changes or [],
        prerequisites=prerequisites or [],
        conflicts=conflicts or [],
        expected_effect=expected_effect or [],
        verify_with=verify_with or [],
        rollback=RollbackPlan(what_to_revert=rollback) if rollback else None,
        reason_codes=reason_codes or [],
    )

def _recommend_duct(snapshot: CellSnapshot, rules: RulesConfig) -> Recommendation | None:
    if not _rule_enabled(rules, "ATMOSPHERIC_DUCT_INTERFERENCE"):
        return None

    duct_flag = bool(snapshot.duct_pattern_flag)
    if snapshot.data_quality_flags:
        duct_flag = duct_flag or "DUCT_PATTERN" in snapshot.data_quality_flags

    hard = bool(snapshot.duplex == "TDD" and duct_flag)
    score = 0.0
    weights = rules.weights.get("ATMOSPHERIC_DUCT_INTERFERENCE", {})

    if snapshot.duplex == "TDD":
        score += weights.get("tdd", 0.0)
    if duct_flag:
        score += weights.get("duct_flag", 0.0)

    if not hard and score == 0:
        return None

    conflicts = []
    if snapshot.is_combined_cell:
        conflicts.append("Combined cell: avoid duct interference reduction.")

    actions = [
        _make_action(
            title="Enable Atmospheric Duct Interference Reduction",
            feature_id="FAJ 121 5065",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5065",
                    mo="EUtranCellTDD",
                    param="ductIntCrsMutingMode",
                    value="PARTIAL",
                    note="Use FULL if severe.",
                ),
                ConfigChange(
                    note="Optionally configure ductIntRedSuppressActPosition for UL symbols."
                ),
            ],
            conflicts=conflicts,
            expected_effect=[
                ExpectedEffect(
                    kpi="pmDuctIntPdschBlankedTti",
                    target_direction="increase",
                    note="Indicates muting applied.",
                )
            ],
            verify_with=["pmDuctIntPdschBlankedTti"] + _common_verify_kpis(),
            rollback="Disable duct interference reduction and revert muting mode.",
            reason_codes=["DUCT_PATTERN", "TDD_DUPLEX"],
        )
    ]

    return Recommendation(
        category="ATMOSPHERIC_DUCT_INTERFERENCE",
        confidence=_confidence(rules, "ATMOSPHERIC_DUCT_INTERFERENCE", hard, score),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("duplex", snapshot.duplex),
            _evidence_line("duct_flag", duct_flag),
        ],
    )


def _spectrogram_evidence(
    snapshot: CellSnapshot, rules: RulesConfig
) -> SpectrogramEvidence | None:
    spec = snapshot.spectrogram
    if not spec or not spec.power_dbm:
        return None
    power = spec.power_dbm
    total = sum(len(row) for row in power)
    if total == 0:
        return None

    power_thr = _get_threshold(rules, "spectrogram_power_dbm_thr", -95)
    hour_thr = _get_threshold(rules, "spectrogram_hour_fraction_thr", 0.4)
    rop_thr = _get_threshold(rules, "spectrogram_rop_fraction_thr", 0.4)

    affected = 0
    max_power = None
    sum_power = 0.0
    count_power = 0
    affected_hours: List[str] = []
    affected_rops: List[float] = []

    for t_index, row in enumerate(power):
        row_total = len(row)
        row_affected = 0
        for value in row:
            sum_power += value
            count_power += 1
            if max_power is None or value > max_power:
                max_power = value
            if value >= power_thr:
                affected += 1
                row_affected += 1
        if row_total > 0 and (row_affected / row_total) >= hour_thr:
            if t_index < len(spec.time_bins):
                affected_hours.append(spec.time_bins[t_index])

    if spec.rop_bins_dbm:
        for r_index, rop in enumerate(spec.rop_bins_dbm):
            col_total = 0
            col_affected = 0
            for t_index in range(len(power)):
                row = power[t_index]
                if r_index < len(row):
                    col_total += 1
                    if row[r_index] >= power_thr:
                        col_affected += 1
            if col_total > 0 and (col_affected / col_total) >= rop_thr:
                affected_rops.append(rop)

    affected_fraction = affected / total
    mean_power = sum_power / count_power if count_power else None

    return SpectrogramEvidence(
        affected_fraction=affected_fraction,
        affected_hours=affected_hours,
        affected_rop_bins_dbm=affected_rops,
        max_power_dbm=max_power,
        mean_power_dbm=mean_power,
    )


def _kpi_affectation(snapshot: CellSnapshot, rules: RulesConfig) -> AffectationSummary:
    kpi_evidence: List[str] = []
    scores: List[float] = []

    ul_sinr_thr = _get_threshold(rules, "ul_sinr_bad_db", -3)
    pusch_bler_thr = _get_threshold(rules, "pusch_bler_high", 0.15)
    pucch_bler_thr = _get_threshold(rules, "pucch_bler_high", 0.15)
    harq_dtx_thr = _get_threshold(rules, "harq_dtx_high", 0.2)

    if snapshot.ul_sinr_db_p50 is not None and snapshot.ul_sinr_db_p50 < ul_sinr_thr:
        scores.append(1.0)
        kpi_evidence.append(_evidence_line("ul_sinr_db_p50", snapshot.ul_sinr_db_p50))
    if snapshot.pusch_bler is not None and snapshot.pusch_bler >= pusch_bler_thr:
        scores.append(1.0)
        kpi_evidence.append(_evidence_line("pusch_bler", snapshot.pusch_bler))
    pucch_bler = snapshot.pucch_bler_avg or snapshot.pucch_bler_p95
    if pucch_bler is not None and pucch_bler >= pucch_bler_thr:
        scores.append(1.0)
        kpi_evidence.append(_evidence_line("pucch_bler", pucch_bler))
    if snapshot.harq_dtx_rate is not None and snapshot.harq_dtx_rate >= harq_dtx_thr:
        scores.append(0.7)
        kpi_evidence.append(_evidence_line("harq_dtx_rate", snapshot.harq_dtx_rate))

    score = sum(scores) / len(scores) if scores else 0.0
    level = "low"
    if score >= 0.7:
        level = "high"
    elif score >= 0.35:
        level = "med"

    return AffectationSummary(level=level, score=score, kpi_evidence=kpi_evidence)


def _overall_affectation(
    kpi_affect: AffectationSummary, spec: SpectrogramEvidence | None, rules: RulesConfig
) -> AffectationSummary:
    if not spec:
        return kpi_affect
    high_thr = _get_threshold(rules, "spectrogram_affect_high", 0.4)
    med_thr = _get_threshold(rules, "spectrogram_affect_med", 0.2)

    spec_level = "low"
    if spec.affected_fraction >= high_thr:
        spec_level = "high"
    elif spec.affected_fraction >= med_thr:
        spec_level = "med"

    levels = [kpi_affect.level, spec_level]
    if "high" in levels:
        level = "high"
    elif "med" in levels:
        level = "med"
    else:
        level = "low"

    score = max(kpi_affect.score, spec.affected_fraction)
    evidence = list(kpi_affect.kpi_evidence)
    evidence.append(_evidence_line("spectrogram_affected_fraction", spec.affected_fraction))
    return AffectationSummary(level=level, score=score, kpi_evidence=evidence)


def _feature_recommendations(
    snapshot: CellSnapshot, affectation: AffectationSummary
) -> List[Recommendation]:
    severity = affectation.level
    confidence = 0.6 if severity == "high" else 0.4 if severity == "med" else 0.25
    reason_codes = [f"AFFECTATION_{severity.upper()}"]

    features = [
        ("ATMOSPHERIC_DUCT_INTERFERENCE", "Enable Atmospheric Duct Interference Reduction", "FAJ 121 5065"),
        ("PIM_CONFIRMED", "Enable PIM Detection", "FAJ 121 5436"),
        ("PIM_CONFIRMED", "Enable LTE PIM Avoidance", "FAJ 121 5448"),
        ("EXTERNAL_WIDEBAND_UL_INTERFERENCE", "Enable IRC", "FAJ 121 4897"),
        ("UL_INTERFERENCE_LIMITED_CAPACITY", "Enable 4x4 Full IRC", "FAJ 121 4901"),
        ("UL_INTERFERENCE_LIMITED_CAPACITY", "Enable IRC for AAS FDD", "FAJ 121 4919"),
        ("PUCCH_EDGE_OR_CONTROL_LIMITATION", "Enable PUCCH Overdimensioning", "FAJ 121 0883"),
        ("PUCCH_EDGE_OR_CONTROL_LIMITATION", "Enable Dynamic PUCCH", "FAJ 121 4377"),
        ("PUCCH_EDGE_OR_CONTROL_LIMITATION", "Enable Flexible Uplink Processing", "FAJ 121 5155"),
        ("OUT_OF_COVERAGE_UES_WASTING_UL", "Enable Uplink-Triggered IF Mobility", "FAJ 121 1797"),
        ("SERVICE_OR_PRIORITY_POLICY_VIOLATION", "Enable SPIFHO", "FAJ 121 3087"),
        ("PDCCH_CONGESTION_OR_LA_MISMATCH", "Enable Decoupled PDCCH LA", "FAJ 121 5716"),
        ("UL_RLC_RETX_CONGESTION", "Enable UL RLC Retx Threshold", "FAJ 121 5641"),
        ("LOAD_IMBALANCE_INTERFREQ", "Enable IFLB", "FAJ 121 3009"),
        ("LOAD_IMBALANCE_INTERFREQ", "Enable IFO", "FAJ 121 3010"),
        ("LOAD_IMBALANCE_INTERFREQ", "Enable IVLB", "FAJ 121 3011"),
        ("LOAD_IMBALANCE_INTERFREQ", "Enable Limited-UL-Aware IFLB", "FAJ 121 5120"),
        ("EXTERNAL_WIDEBAND_UL_INTERFERENCE", "Enable ICIC Autonomous Resource Allocation", "FAJ 121 2001"),
        ("EXTERNAL_WIDEBAND_UL_INTERFERENCE", "Run Uplink Spectrum Analyzer", "FAJ 121 4271"),
        ("EXTERNAL_NARROWBAND_UL_INTERFERENCE", "Enable Multi-Clustered PUSCH", "FAJ 121 4759"),
        ("OUT_OF_COVERAGE_UES_WASTING_UL", "Enable Out-of-Coverage UL Scheduling Control", "FAJ 121 4524"),
        ("EMF_POWER_CAP_LIMITING", "Review Intelligent Power Emission Control", "FAJ 121 5224"),
        ("UL_LATENCY", "Enable Instant Uplink Access", "FAJ 121 4831"),
        ("NR_MASSIVE_MIMO_COCHANNEL_DL_INTERFERENCE", "Enable Interference Sensing", "FAJ 121 5611"),
    ]

    recs: List[Recommendation] = []
    for category, title, feature_id in features:
        recs.append(
            Recommendation(
                category=category,
                confidence=confidence,
                severity=severity,
                actions=[
                    _make_action(
                        title=title,
                        feature_id=feature_id,
                        config_changes=[
                            ConfigChange(
                                feature_id=feature_id,
                                mo="EUtranCell*",
                                param="enable",
                                value=True,
                                note="Replace with real MO/param for this feature.",
                            )
                        ],
                        expected_effect=[
                            ExpectedEffect(
                                kpi="pusch_bler",
                                target_direction="decrease",
                                note="Based on affectation level.",
                            ),
                            ExpectedEffect(
                                kpi="pucch_bler_avg",
                                target_direction="decrease",
                                note="Based on affectation level.",
                            ),
                        ],
                        verify_with=_common_verify_kpis(),
                        rollback="Disable feature and revert parameters if KPIs degrade.",
                        reason_codes=reason_codes,
                    )
                ],
                explanations=affectation.kpi_evidence,
            )
        )

    return recs


def _recommend_pim(snapshot: CellSnapshot, rules: RulesConfig) -> Recommendation | None:
    if not _rule_enabled(rules, "PIM_CONFIRMED"):
        return None
    thr = _get_threshold(rules, "pim_reliability_thr", 0.55)
    hard = bool(
        snapshot.pim_class == "PIM_DISTRIBUIDO"
        and (snapshot.pim_reliability or 0) >= thr
    )
    weights = rules.weights.get("PIM_CONFIRMED", {})
    score = 0.0
    if snapshot.pim_class == "PIM_DISTRIBUIDO":
        score += weights.get("pim_class", 0.0)
    if snapshot.pim_reliability is not None and snapshot.pim_reliability >= thr:
        score += weights.get("pim_reliability", 0.0)
    if not hard and score == 0:
        return None

    actions = [
        _make_action(
            title="Enable PIM Detection",
            feature_id="FAJ 121 5436",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5436",
                    mo="EUtranCell*",
                    param="pimDetectionEnabled",
                    value=True,
                )
            ],
            expected_effect=[
                ExpectedEffect(kpi="ul_thp_mbps", target_direction="increase")
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable PIM Detection if no improvement.",
            reason_codes=["PIM_DISTRIBUIDO"],
        ),
        _make_action(
            title="Enable LTE PIM Avoidance",
            feature_id="FAJ 121 5448",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5448",
                    mo="EUtranCell*",
                    param="pimAvoidanceEnabled",
                    value=True,
                )
            ],
            prerequisites=["PIM Detection enabled"],
            expected_effect=[
                ExpectedEffect(kpi="rssi_avg_dbm", target_direction="decrease"),
                ExpectedEffect(kpi="ul_thp_mbps", target_direction="increase"),
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable PIM Avoidance and revert config.",
            reason_codes=["PIM_CONFIRMED"],
        ),
        _make_action(
            title="Field inspection for PIM sources",
            config_changes=[],
            prerequisites=[],
            expected_effect=[
                ExpectedEffect(
                    kpi="rssi_avg_dbm",
                    target_direction="decrease",
                    note="Connector/feeder issues corrected.",
                )
            ],
            verify_with=["rssi_avg_dbm", "ul_sinr_db_p10"],
            rollback="N/A - operational procedure.",
            reason_codes=["FIELD_CHECK"],
        ),
    ]

    return Recommendation(
        category="PIM_CONFIRMED",
        confidence=_confidence(rules, "PIM_CONFIRMED", hard, score),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("pim_class", snapshot.pim_class),
            _evidence_line("pim_reliability", snapshot.pim_reliability),
        ],
    )


def _recommend_pim_suspected(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "PIM_SUSPECTED"):
        return None
    thr = _get_threshold(rules, "pim_reliability_thr", 0.55)
    delta_ports_thr = _get_threshold(rules, "delta_ports_db_thr", 4.0)
    traffic_corr_thr = _get_threshold(rules, "traffic_corr_thr", 0.5)

    suspect = snapshot.pim_class in ["AMBIGUO", "TRAFFIC_BASED"]
    corr_flag = (
        (snapshot.traffic_corr or 0) >= traffic_corr_thr
        and (snapshot.delta_ports_db or 0) >= delta_ports_thr
    )

    hard = bool(suspect or corr_flag)
    if not hard:
        return None

    actions = [
        _make_action(
            title="Enable PIM Detection for confirmation",
            feature_id="FAJ 121 5436",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5436",
                    mo="EUtranCell*",
                    param="pimDetectionEnabled",
                    value=True,
                )
            ],
            expected_effect=[
                ExpectedEffect(kpi="pim_reliability", target_direction="increase")
            ],
            verify_with=["pim_reliability", "rssi_avg_dbm", "ul_sinr_db_p10"],
            rollback="Disable PIM Detection if not supported.",
            reason_codes=["PIM_SUSPECTED"],
        )
    ]

    return Recommendation(
        category="PIM_SUSPECTED",
        confidence=_confidence(rules, "PIM_SUSPECTED", hard, 1.0),
        severity="med",
        actions=actions,
        explanations=[
            _evidence_line("pim_class", snapshot.pim_class),
            _evidence_line("traffic_corr", snapshot.traffic_corr),
            _evidence_line("delta_ports_db", snapshot.delta_ports_db),
        ],
    )


def _recommend_external_ei(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "EXTERNAL_WIDEBAND_UL_INTERFERENCE"):
        return None
    wideband = bool(snapshot.ni_prb_profile and snapshot.ni_prb_profile.wideband_flag)
    hard = bool(snapshot.ei_neighbor_match_flag)
    weights = rules.weights.get("EXTERNAL_WIDEBAND_UL_INTERFERENCE", {})
    score = 0.0
    if snapshot.ei_neighbor_match_flag:
        score += weights.get("ei_neighbor_match", 0.0)
    if wideband:
        score += weights.get("wideband_flag", 0.0)

    if not hard and score == 0:
        return None

    actions = [
        _make_action(
            title="Run Uplink Spectrum Analyzer",
            feature_id="FAJ 121 4271",
            expected_effect=[
                ExpectedEffect(
                    kpi="ul_sinr_db_p10",
                    target_direction="increase",
                    note="Identify external interferer.",
                )
            ],
            verify_with=["ul_sinr_db_p10", "rssi_avg_dbm"],
            rollback="N/A - analysis step.",
            reason_codes=["EI_NEIGHBOR_MATCH" if hard else "WIDEBAND_NI"],
        ),
        _make_action(
            title="Enable IRC or 4x4 IRC if supported",
            feature_id="FAJ 121 4901",
            prerequisites=["4RX available for 4x4 IRC"],
            expected_effect=[
                ExpectedEffect(kpi="ul_sinr_db_p10", target_direction="increase"),
                ExpectedEffect(kpi="pusch_bler", target_direction="decrease"),
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable IRC features if regressions observed.",
            reason_codes=["IRC_MITIGATION"],
        ),
        _make_action(
            title="Enable ICIC Autonomous Resource Allocation",
            feature_id="FAJ 121 2001",
            expected_effect=[
                ExpectedEffect(
                    kpi="ul_sinr_db_p50",
                    target_direction="increase",
                    note="Reduce inter-cell interference.",
                )
            ],
            verify_with=["ul_sinr_db_p50", "harq_nack_rate"],
            rollback="Disable ICIC if no gain.",
            reason_codes=["INTER_CELL_EI"],
        ),
    ]

    return Recommendation(
        category="EXTERNAL_WIDEBAND_UL_INTERFERENCE",
        confidence=_confidence(rules, "EXTERNAL_WIDEBAND_UL_INTERFERENCE", hard, score),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("ei_neighbor_match_flag", snapshot.ei_neighbor_match_flag),
            _evidence_line("wideband_flag", wideband),
        ],
    )


def _recommend_external_narrowband(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "EXTERNAL_NARROWBAND_UL_INTERFERENCE"):
        return None
    narrowband = bool(
        snapshot.ni_prb_profile and snapshot.ni_prb_profile.narrowband_flag
    )
    if not narrowband:
        return None

    actions = [
        _make_action(
            title="Run Uplink Spectrum Analyzer",
            feature_id="FAJ 121 4271",
            expected_effect=[
                ExpectedEffect(
                    kpi="ul_sinr_db_p10",
                    target_direction="increase",
                    note="Locate narrowband interferer.",
                )
            ],
            verify_with=["ul_sinr_db_p10", "rssi_avg_dbm"],
            rollback="N/A - analysis step.",
            reason_codes=["NARROWBAND_NI"],
        ),
        _make_action(
            title="Enable Multi-Clustered PUSCH",
            feature_id="FAJ 121 4759",
            expected_effect=[
                ExpectedEffect(kpi="pusch_bler", target_direction="decrease")
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable Multi-Clustered PUSCH if no gain.",
            reason_codes=["NARROWBAND_NI"],
        ),
    ]

    return Recommendation(
        category="EXTERNAL_NARROWBAND_UL_INTERFERENCE",
        confidence=_confidence(rules, "EXTERNAL_NARROWBAND_UL_INTERFERENCE", True, 1.0),
        severity="med",
        actions=actions,
        explanations=[_evidence_line("narrowband_flag", narrowband)],
    )


def _recommend_ul_capacity(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "UL_INTERFERENCE_LIMITED_CAPACITY"):
        return None
    thr = _get_threshold(rules, "ul_sinr_bad_db", -3)
    hard = bool(
        (snapshot.ul_sinr_db_p50 is not None and snapshot.ul_sinr_db_p50 < thr)
        and snapshot.has_4rx
    )
    weights = rules.weights.get("UL_INTERFERENCE_LIMITED_CAPACITY", {})
    score = 0.0
    if snapshot.ul_sinr_db_p50 is not None and snapshot.ul_sinr_db_p50 < thr:
        score += weights.get("ul_sinr_bad", 0.0)
    if snapshot.has_4rx:
        score += weights.get("has_4rx", 0.0)

    if not hard and score == 0:
        return None

    actions = [
        _make_action(
            title="Enable IRC",
            feature_id="FAJ 121 4897",
            expected_effect=[
                ExpectedEffect(kpi="ul_sinr_db_p10", target_direction="increase"),
                ExpectedEffect(kpi="pusch_bler", target_direction="decrease"),
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable IRC if no improvement.",
            reason_codes=["UL_SINR_LT_THR"],
        )
    ]
    if snapshot.has_4rx:
        actions.append(
            _make_action(
                title="Enable 4x4 Full IRC",
                feature_id="FAJ 121 4901",
                prerequisites=["4RX hardware support"],
                expected_effect=[
                    ExpectedEffect(
                        kpi="ul_sinr_db_p10", target_direction="increase"
                    )
                ],
                verify_with=_common_verify_kpis(),
                rollback="Disable 4x4 IRC if instability observed.",
                reason_codes=["HAS_4RX"],
            )
        )
    if snapshot.is_aas and snapshot.duplex == "FDD":
        actions.append(
            _make_action(
                title="Enable IRC for AAS FDD",
                feature_id="FAJ 121 4919",
                prerequisites=["AAS FDD capability"],
                expected_effect=[
                    ExpectedEffect(
                        kpi="ul_sinr_db_p50", target_direction="increase"
                    )
                ],
                verify_with=_common_verify_kpis(),
                rollback="Disable AAS IRC if no gain.",
                reason_codes=["AAS_FDD"],
            )
        )

    return Recommendation(
        category="UL_INTERFERENCE_LIMITED_CAPACITY",
        confidence=_confidence(rules, "UL_INTERFERENCE_LIMITED_CAPACITY", hard, score),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("ul_sinr_db_p50", snapshot.ul_sinr_db_p50),
            _evidence_line("has_4rx", snapshot.has_4rx),
        ],
    )

def _recommend_ul_mobility(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "OUT_OF_COVERAGE_UES_WASTING_UL"):
        return None
    sinr_thr = _get_threshold(rules, "ul_sinr_bad_db", -3)
    dtx_thr = _get_threshold(rules, "harq_dtx_high", 0.2)
    hard = bool(
        (snapshot.ul_sinr_db_p10 is not None and snapshot.ul_sinr_db_p10 < sinr_thr)
        and (snapshot.harq_dtx_rate or 0) >= dtx_thr
    )
    weights = rules.weights.get("OUT_OF_COVERAGE_UES_WASTING_UL", {})
    score = 0.0
    if snapshot.harq_dtx_rate is not None and snapshot.harq_dtx_rate >= dtx_thr:
        score += weights.get("harq_dtx_high", 0.0)
    if snapshot.ul_sinr_db_p10 is not None and snapshot.ul_sinr_db_p10 < sinr_thr:
        score += weights.get("ul_sinr_bad", 0.0)

    if not hard and score == 0:
        return None

    actions = [
        _make_action(
            title="Enable Uplink-Triggered Inter-Frequency Mobility",
            feature_id="FAJ 121 1797",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 1797",
                    mo="ReportConfigSearch",
                    param="a1a2UlSearchThreshold",
                    value=320,
                    note="Tune below 320 if persistent UL issues.",
                )
            ],
            expected_effect=[
                ExpectedEffect(kpi="harq_dtx_rate", target_direction="decrease"),
                ExpectedEffect(kpi="ul_sinr_db_p10", target_direction="increase"),
            ],
            verify_with=_common_verify_kpis(),
            rollback="Disable UL-triggered IF mobility if HO churn occurs.",
            reason_codes=["UL_SINR_LT_THR", "HARQ_DTX_HIGH"],
        )
    ]

    return Recommendation(
        category="OUT_OF_COVERAGE_UES_WASTING_UL",
        confidence=_confidence(rules, "OUT_OF_COVERAGE_UES_WASTING_UL", hard, score),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("harq_dtx_rate", snapshot.harq_dtx_rate),
            _evidence_line("ul_sinr_db_p10", snapshot.ul_sinr_db_p10),
        ],
    )


def _recommend_voice(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "VOICE_QCI1_AT_RISK"):
        return None
    qci_users = snapshot.qci1_active_users or 0
    hard = bool(snapshot.qci1_kpi_degraded)
    weights = rules.weights.get("VOICE_QCI1_AT_RISK", {})
    score = 0.0
    if snapshot.qci1_kpi_degraded:
        score += weights.get("qci1_degraded", 0.0)
    if qci_users > 0:
        score += weights.get("qci1_users", 0.0)
    if snapshot.harq_dtx_rate:
        score += weights.get("harq_dtx_high", 0.0)

    if not hard and score == 0:
        return None

    conflicts = []
    if snapshot.spifho_configured and snapshot.servOrPrioTriggeredIFHo == "QCI":
        conflicts.append("SPIFHO(QCI) may limit UL-triggered VoLTE mobility.")

    actions = [
        _make_action(
            title="Enable Uplink-Triggered VoLTE Mobility",
            feature_id="FAJ 121 5433",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5433",
                    mo="EUtranCellFDD/TDD",
                    param="ulVolteTriggeredMobilityEnabled",
                    value=True,
                )
            ],
            conflicts=conflicts,
            expected_effect=[
                ExpectedEffect(kpi="qci1_drop_rate", target_direction="decrease"),
                ExpectedEffect(kpi="harq_dtx_rate", target_direction="decrease"),
            ],
            verify_with=["qci1_drop_rate", "harq_dtx_rate", "ul_sinr_db_p10"],
            rollback="Disable UL-triggered VoLTE mobility if churn observed.",
            reason_codes=["QCI1_AT_RISK"],
        )
    ]

    return Recommendation(
        category="VOICE_QCI1_AT_RISK",
        confidence=_confidence(rules, "VOICE_QCI1_AT_RISK", hard, score),
        severity=_severity(snapshot, hard, extra_high=bool(snapshot.qci1_kpi_degraded)),
        actions=actions,
        explanations=[
            _evidence_line("qci1_kpi_degraded", snapshot.qci1_kpi_degraded),
            _evidence_line("qci1_active_users", qci_users),
        ],
    )


def _recommend_pucch_edge(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "PUCCH_EDGE_OR_CONTROL_LIMITATION"):
        return None

    pucch_bler = snapshot.pucch_bler_avg or snapshot.pucch_bler_p95
    bler_high = _get_threshold(rules, "pucch_bler_high", 0.15)
    bler_very_high = _get_threshold(rules, "pucch_bler_very_high", 0.25)
    sr_fail_high = _get_threshold(rules, "sr_fail_rate_high", 0.05)
    edge_strength_thr = _get_threshold(rules, "edge_peaks_strength_high_db", 3.0)

    edge_flag = bool(snapshot.ni_prb_profile and snapshot.ni_prb_profile.edge_peaks_flag)
    edge_strength = (
        snapshot.ni_prb_profile.edge_peaks_strength_db
        if snapshot.ni_prb_profile
        else None
    )

    hard = bool(
        (pucch_bler is not None and pucch_bler >= bler_high)
        and (
            snapshot.ampr_restriction_suspected
            or snapshot.adjacent_band_interference_suspected
            or edge_flag
        )
    )

    weights = rules.weights.get("PUCCH_EDGE_OR_CONTROL_LIMITATION", {})
    score = 0.0
    if pucch_bler is not None and pucch_bler >= bler_high:
        score += weights.get("pucch_bler_high", 0.0)
    if snapshot.sr_fail_rate is not None and snapshot.sr_fail_rate >= sr_fail_high:
        score += weights.get("sr_fail_rate_high", 0.0)
    if edge_flag:
        score += weights.get("edge_peaks_flag", 0.0)
    if edge_strength is not None and edge_strength >= edge_strength_thr:
        score += weights.get("edge_peaks_strength", 0.0)

    if not hard and score == 0:
        return None

    actions = [
        _make_action(
            title="Enable PUCCH Overdimensioning",
            feature_id="FAJ 121 0883",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 0883",
                    mo="EUtranCell*",
                    param="pucchOverdimensioningEnabled",
                    value=True,
                ),
                ConfigChange(
                    note="Define PUCCH region offset away from edge PRBs with N+I peaks."
                ),
            ],
            expected_effect=[
                ExpectedEffect(kpi="pucch_bler_avg", target_direction="decrease"),
                ExpectedEffect(kpi="sr_fail_rate", target_direction="decrease"),
            ],
            verify_with=["pucch_bler_avg", "sr_fail_rate", "cqi_report_drop_rate"],
            rollback="Disable PUCCH overdimensioning and revert region.",
            reason_codes=["PUCCH_EDGE", "EDGE_PRB_PEAKS"],
        )
    ]

    if snapshot.pucch_resource_pressure and snapshot.pucch_resource_pressure > 0.7:
        actions.append(
            _make_action(
                title="Enable Dynamic PUCCH",
                feature_id="FAJ 121 4377",
                expected_effect=[
                    ExpectedEffect(
                        kpi="pucch_resource_pressure",
                        target_direction="decrease",
                    )
                ],
                verify_with=["pucch_resource_pressure", "pucch_bler_avg"],
                rollback="Disable Dynamic PUCCH if regression.",
                reason_codes=["PUCCH_RESOURCE_PRESSURE"],
            )
        )
        actions.append(
            _make_action(
                title="Enable Flexible Uplink Processing",
                feature_id="FAJ 121 5155",
                expected_effect=[
                    ExpectedEffect(kpi="sr_fail_rate", target_direction="decrease")
                ],
                verify_with=["sr_fail_rate", "cqi_report_drop_rate"],
                rollback="Disable Flexible Uplink Processing if no gain.",
                reason_codes=["SR_CQI_PRESSURE"],
            )
        )

    return Recommendation(
        category="PUCCH_EDGE_OR_CONTROL_LIMITATION",
        confidence=_confidence(
            rules, "PUCCH_EDGE_OR_CONTROL_LIMITATION", hard, score
        ),
        severity=_severity(
            snapshot,
            hard,
            extra_high=bool(pucch_bler is not None and pucch_bler >= bler_very_high),
        ),
        actions=actions,
        explanations=[
            _evidence_line("pucch_bler", pucch_bler),
            _evidence_line("edge_peaks_flag", edge_flag),
            _evidence_line("ampr_restriction_suspected", snapshot.ampr_restriction_suspected),
            _evidence_line("adjacent_band_interference_suspected", snapshot.adjacent_band_interference_suspected),
        ],
    )


def _recommend_pucch_band_issue(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "PUCCH_EDGE_BAND_ISSUE"):
        return None
    bler_high = _get_threshold(rules, "pucch_bler_high", 0.15)
    pucch_bler = snapshot.pucch_bler_avg or snapshot.pucch_bler_p95
    edge_flag = bool(snapshot.ni_prb_profile and snapshot.ni_prb_profile.edge_peaks_flag)
    band_issue = bool(
        snapshot.ampr_restriction_suspected
        or snapshot.adjacent_band_interference_suspected
        or edge_flag
    )
    if not band_issue or (pucch_bler is None or pucch_bler < bler_high):
        return None

    actions = [
        _make_action(
            title="Enable PUCCH Overdimensioning",
            feature_id="FAJ 121 0883",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 0883",
                    mo="EUtranCell*",
                    param="pucchOverdimensioningEnabled",
                    value=True,
                )
            ],
            expected_effect=[
                ExpectedEffect(kpi="pucch_bler_avg", target_direction="decrease")
            ],
            verify_with=["pucch_bler_avg", "sr_fail_rate"],
            rollback="Disable PUCCH overdimensioning if no gain.",
            reason_codes=["PUCCH_EDGE_BAND"],
        )
    ]

    return Recommendation(
        category="PUCCH_EDGE_BAND_ISSUE",
        confidence=_confidence(rules, "PUCCH_EDGE_BAND_ISSUE", True, 1.0),
        severity="med",
        actions=actions,
        explanations=[
            _evidence_line("pucch_bler", pucch_bler),
            _evidence_line("band_issue", band_issue),
        ],
    )

def _recommend_pdcch(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "PDCCH_CONGESTION_OR_LA_MISMATCH"):
        return None
    pdcch_thr = _get_threshold(rules, "pdcch_util_high", 0.85)
    cce_thr = _get_threshold(rules, "cce_blocking_high", 0.1)
    hard = bool(
        (snapshot.pdcch_util or 0) >= pdcch_thr
        or (snapshot.cce_blocking_rate or 0) >= cce_thr
    )
    if not hard:
        return None

    actions = [
        _make_action(
            title="Enable Decoupled DL/UL PDCCH Link Adaptation",
            feature_id="FAJ 121 5716",
            prerequisites=["Enhanced PDCCH Link Adaptation (FAJ 121 3051)"],
            expected_effect=[
                ExpectedEffect(kpi="cce_blocking_rate", target_direction="decrease")
            ],
            verify_with=["pdcch_util", "cce_blocking_rate"],
            rollback="Disable Decoupled PDCCH LA if no improvement.",
            reason_codes=["PDCCH_CONGESTION"],
        )
    ]

    return Recommendation(
        category="PDCCH_CONGESTION_OR_LA_MISMATCH",
        confidence=_confidence(rules, "PDCCH_CONGESTION_OR_LA_MISMATCH", hard, 1.0),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("pdcch_util", snapshot.pdcch_util),
            _evidence_line("cce_blocking_rate", snapshot.cce_blocking_rate),
        ],
    )


def _recommend_rlc(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "UL_RLC_RETX_CONGESTION"):
        return None
    retx_thr = _get_threshold(rules, "ul_rlc_retx_high", 0.15)
    buffer_thr = _get_threshold(rules, "rlc_buffer_high", 0.8)
    hard = bool(
        (snapshot.ul_rlc_retx_rate or 0) >= retx_thr
        and (snapshot.rlc_buffer_usage or 0) >= buffer_thr
    )
    if not hard:
        return None

    actions = [
        _make_action(
            title="Enable UL Load-Based RLC Retransmission Threshold",
            feature_id="FAJ 121 5641",
            expected_effect=[
                ExpectedEffect(kpi="ul_rlc_retx_rate", target_direction="decrease")
            ],
            verify_with=["ul_rlc_retx_rate", "rlc_buffer_usage"],
            rollback="Disable UL RLC retx threshold if KPIs degrade.",
            reason_codes=["RLC_RETX_CONGESTION"],
        )
    ]

    return Recommendation(
        category="UL_RLC_RETX_CONGESTION",
        confidence=_confidence(rules, "UL_RLC_RETX_CONGESTION", hard, 1.0),
        severity=_severity(snapshot, hard),
        actions=actions,
        explanations=[
            _evidence_line("ul_rlc_retx_rate", snapshot.ul_rlc_retx_rate),
            _evidence_line("rlc_buffer_usage", snapshot.rlc_buffer_usage),
        ],
    )


def _recommend_load_imbalance(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "LOAD_IMBALANCE_INTERFREQ"):
        return None
    imbalance_thr = _get_threshold(rules, "load_imbalance_thr", 0.2)
    imbalance = False
    if snapshot.load_imbalance_flag is not None:
        imbalance = snapshot.load_imbalance_flag
    elif (
        snapshot.carrier_a_util is not None
        and snapshot.carrier_b_util is not None
    ):
        imbalance = (snapshot.carrier_a_util - snapshot.carrier_b_util) >= imbalance_thr

    if not imbalance:
        return None

    conflicts = []
    if snapshot.ifo_enabled and snapshot.ivlb_enabled:
        conflicts.append("IVLB and IFO cannot coexist on same relation.")

    actions = [
        _make_action(
            title="Enable Inter-Frequency Load Balancing (IFLB)",
            feature_id="FAJ 121 3009",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 3009",
                    mo="EUtranCellRelation",
                    param="iflbEnabled",
                    value=True,
                ),
                ConfigChange(
                    feature_id="FAJ 121 3058",
                    mo="EUtranCellRelation",
                    param="iflbActivationThresholdEnabled",
                    value=True,
                ),
            ],
            conflicts=conflicts,
            expected_effect=[
                ExpectedEffect(kpi="load_balance", target_direction="improve")
            ],
            verify_with=["carrier_a_util", "carrier_b_util"],
            rollback="Disable IFLB/activation threshold if churn observed.",
            reason_codes=["LOAD_IMBALANCE"],
        )
    ]

    return Recommendation(
        category="LOAD_IMBALANCE_INTERFREQ",
        confidence=_confidence(rules, "LOAD_IMBALANCE_INTERFREQ", True, 1.0),
        severity="med",
        actions=actions,
        explanations=[
            _evidence_line("carrier_a_util", snapshot.carrier_a_util),
            _evidence_line("carrier_b_util", snapshot.carrier_b_util),
        ],
    )


def _recommend_nr_dl_interference(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "NR_MASSIVE_MIMO_COCHANNEL_DL_INTERFERENCE"):
        return None
    hard = bool(
        snapshot.tech == "NR"
        and snapshot.is_massive_mimo
        and snapshot.dl_interference_dominant
    )
    if not hard:
        return None

    actions = [
        _make_action(
            title="Enable Interference Sensing",
            feature_id="FAJ 121 5611",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 5611",
                    mo="NRCellDU",
                    param="interferenceSensingEnabled",
                    value=True,
                )
            ],
            prerequisites=["AAS radios with SRS support"],
            expected_effect=[
                ExpectedEffect(kpi="dl_thp_mbps", target_direction="increase")
            ],
            verify_with=["dl_thp_mbps", "dl_sinr_db"],
            rollback="Disable interference sensing if no gain.",
            reason_codes=["NR_MMIMO_COCHANNEL"],
        )
    ]

    return Recommendation(
        category="NR_MASSIVE_MIMO_COCHANNEL_DL_INTERFERENCE",
        confidence=_confidence(
            rules, "NR_MASSIVE_MIMO_COCHANNEL_DL_INTERFERENCE", True, 1.0
        ),
        severity="high",
        actions=actions,
        explanations=[
            _evidence_line("tech", snapshot.tech),
            _evidence_line("is_massive_mimo", snapshot.is_massive_mimo),
        ],
    )


def _recommend_emf(snapshot: CellSnapshot, rules: RulesConfig) -> Recommendation | None:
    if not _rule_enabled(rules, "EMF_POWER_CAP_LIMITING"):
        return None
    hard = bool(snapshot.emf_power_cap_flag)
    if not hard:
        return None
    actions = [
        _make_action(
            title="Review Intelligent Power Emission Control limits",
            feature_id="FAJ 121 5224",
            expected_effect=[
                ExpectedEffect(kpi="dl_thp_mbps", target_direction="increase")
            ],
            verify_with=["dl_thp_mbps", "power_cap_events"],
            rollback="Restore EMF limits if compliance impacted.",
            reason_codes=["EMF_CAP_SUSPECTED"],
        )
    ]
    return Recommendation(
        category="EMF_POWER_CAP_LIMITING",
        confidence=_confidence(rules, "EMF_POWER_CAP_LIMITING", True, 1.0),
        severity="med",
        actions=actions,
        explanations=[
            _evidence_line("emf_power_cap_flag", snapshot.emf_power_cap_flag)
        ],
    )


def _recommend_latency(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "UL_LATENCY"):
        return None
    hard = bool(snapshot.ul_latency_sensitive)
    if not hard:
        return None
    actions = [
        _make_action(
            title="Enable Instant Uplink Access",
            feature_id="FAJ 121 4831",
            expected_effect=[
                ExpectedEffect(kpi="ul_latency_ms", target_direction="decrease")
            ],
            verify_with=["ul_latency_ms", "sr_fail_rate"],
            rollback="Disable Instant Uplink Access if no latency gain.",
            reason_codes=["LATENCY_TARGET"],
        )
    ]
    return Recommendation(
        category="UL_LATENCY",
        confidence=_confidence(rules, "UL_LATENCY", True, 1.0),
        severity="low",
        actions=actions,
        explanations=[_evidence_line("ul_latency_sensitive", snapshot.ul_latency_sensitive)],
    )


def _recommend_spifho(
    snapshot: CellSnapshot, rules: RulesConfig
) -> Recommendation | None:
    if not _rule_enabled(rules, "SERVICE_OR_PRIORITY_POLICY_VIOLATION"):
        return None
    qci_users_min = int(_get_threshold(rules, "qci1_users_min", 1))
    hard = bool(
        snapshot.voice_allowed_on_serving_freq is False
        and (snapshot.qci1_active_users or 0) >= qci_users_min
    )
    emergency = bool(snapshot.emergency_location_requires)
    if not hard and not emergency:
        return None

    trigger_value = "QCI"
    if (snapshot.arp_high_prio_users or 0) > 0:
        trigger_value = "ARP"

    conflicts = []
    if snapshot.spifho_configured and snapshot.servOrPrioTriggeredIFHo == "QCI":
        if snapshot.ul_volte_triggered_mobility_enabled:
            conflicts.append(
                "SPIFHO(QCI) can limit UL-triggered VoLTE mobility. Choose primary strategy."
            )

    actions = [
        _make_action(
            title="Enable Service/Priority-Triggered IF Handover (SPIFHO)",
            feature_id="FAJ 121 3087",
            config_changes=[
                ConfigChange(
                    feature_id="FAJ 121 3087",
                    mo="EUtranCellFDD/TDD",
                    param="servOrPrioTriggeredIFHo",
                    value=trigger_value,
                ),
                ConfigChange(
                    feature_id="FAJ 121 3087",
                    mo="EUtranCellFDD/TDD",
                    param="servOrPrioIFHoSetupBearer",
                    value=False,
                ),
            ],
            conflicts=conflicts,
            expected_effect=[
                ExpectedEffect(
                    kpi="qci1_accessibility", target_direction="increase"
                ),
                ExpectedEffect(kpi="qci1_drop_rate", target_direction="decrease"),
            ],
            verify_with=["qci1_accessibility", "qci1_drop_rate", "hosr"],
            rollback="Disable SPIFHO and revert parameters.",
            reason_codes=["POLICY_VIOLATION"],
        )
    ]

    return Recommendation(
        category="SERVICE_OR_PRIORITY_POLICY_VIOLATION",
        confidence=_confidence(
            rules, "SERVICE_OR_PRIORITY_POLICY_VIOLATION", True, 1.0
        ),
        severity="high" if hard else "med",
        actions=actions,
        explanations=[
            _evidence_line(
                "voice_allowed_on_serving_freq", snapshot.voice_allowed_on_serving_freq
            ),
            _evidence_line("qci1_active_users", snapshot.qci1_active_users),
            _evidence_line("emergency_location_requires", snapshot.emergency_location_requires),
        ],
    )


def _recommend_unknown(snapshot: CellSnapshot) -> Recommendation:
    actions = [
        _make_action(
            title="Collect additional diagnostics",
            expected_effect=[
                ExpectedEffect(
                    kpi="data_quality_flags",
                    target_direction="improve",
                    note="Add traces, NI PRB profile, and PIM/EI classifiers.",
                )
            ],
            verify_with=[
                "ul_sinr_db_p10",
                "rssi_avg_dbm",
                "ni_prb_profile",
                "pucch_bler_avg",
            ],
            rollback="N/A - data collection step.",
            reason_codes=["NO_RULE_MATCH"],
        )
    ]

    return Recommendation(
        category="UNKNOWN_AMBIGUOUS",
        confidence=0.2,
        severity="low",
        actions=actions,
        explanations=["No rule matched with available evidence."],
    )


def evaluate(snapshot: CellSnapshot, rules: RulesConfig) -> AdvisoryOutput:
    recommendations: List[Recommendation] = []
    do_not_do: List[str] = []
    spectral = _spectrogram_evidence(snapshot, rules)
    kpi_affect = _kpi_affectation(snapshot, rules)
    overall_affect = _overall_affectation(kpi_affect, spectral, rules)

    ordered_rules = [
        _recommend_duct,
        _recommend_pim,
        _recommend_pim_suspected,
        _recommend_external_ei,
        _recommend_external_narrowband,
        _recommend_ul_capacity,
        _recommend_pucch_edge,
        _recommend_ul_mobility,
        _recommend_voice,
        _recommend_pdcch,
        _recommend_rlc,
        _recommend_load_imbalance,
        _recommend_nr_dl_interference,
        _recommend_emf,
        _recommend_latency,
        _recommend_spifho,
    ]

    for rec in ordered_rules:
        result = rec(snapshot, rules)
        if result:
            recommendations.append(result)

    recommendations.extend(_feature_recommendations(snapshot, overall_affect))

    has_pucch_edge = any(
        rec.category == "PUCCH_EDGE_OR_CONTROL_LIMITATION" for rec in recommendations
    )
    if not has_pucch_edge:
        band_issue = _recommend_pucch_band_issue(snapshot, rules)
        if band_issue:
            recommendations.append(band_issue)

    if not recommendations:
        recommendations.append(_recommend_unknown(snapshot))

    for rec in recommendations:
        for action in rec.actions:
            for conflict in action.conflicts:
                if conflict not in do_not_do:
                    do_not_do.append(conflict)

    recommendations.sort(key=lambda item: item.confidence, reverse=True)

    explanations: List[str] = []
    for rec in recommendations:
        explanations.extend(rec.explanations)

    return AdvisoryOutput(
        cell_id=snapshot.cell_id,
        snapshot_day=snapshot.snapshot_day,
        recommendations=recommendations,
        explanations=explanations,
        do_not_do=do_not_do,
        spectral_evidence=spectral,
        affectation=overall_affect,
    )


def evaluate_many(
    snapshots: List[CellSnapshot], rules: RulesConfig
) -> List[AdvisoryOutput]:
    return [evaluate(snapshot, rules) for snapshot in snapshots]
