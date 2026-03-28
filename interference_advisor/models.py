from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NeighborRelation(BaseModel):
    neighbor_cell_id: str
    same_band: Optional[bool] = None
    vendor: Optional[str] = None
    relation_type: Optional[str] = None


class NiPrbProfile(BaseModel):
    delta_prb_db: Optional[float] = None
    edge_peaks_flag: Optional[bool] = None
    wideband_flag: Optional[bool] = None
    narrowband_flag: Optional[bool] = None
    edge_peaks_strength_db: Optional[float] = None


class Spectrogram(BaseModel):
    cell_id: Optional[str] = None
    time_bins: List[str] = Field(default_factory=list)
    rop_bins_dbm: List[float] = Field(default_factory=list)
    power_dbm: List[List[float]] = Field(default_factory=list)


class SpectrogramEvidence(BaseModel):
    affected_fraction: float
    affected_hours: List[str]
    affected_rop_bins_dbm: List[float]
    max_power_dbm: Optional[float] = None
    mean_power_dbm: Optional[float] = None


class AffectationSummary(BaseModel):
    level: Literal["low", "med", "high"]
    score: float
    kpi_evidence: List[str]


class CellSnapshot(BaseModel):
    snapshot_day: Optional[str] = None
    snapshot_hour: Optional[int] = None

    cell_id: str
    site_id: Optional[str] = None
    tech: Optional[Literal["LTE", "NR"]] = None
    duplex: Optional[Literal["FDD", "TDD"]] = None
    band: Optional[str] = None
    bw_mhz: Optional[float] = None

    has_4rx: Optional[bool] = None
    is_aas: Optional[bool] = None
    is_massive_mimo: Optional[bool] = None
    is_combined_cell: Optional[bool] = None

    neighbors: Optional[List[NeighborRelation]] = None

    ul_sinr_db_p50: Optional[float] = None
    ul_sinr_db_p10: Optional[float] = None
    pusch_bler: Optional[float] = None
    pucch_bler_p50: Optional[float] = None
    pucch_bler_p95: Optional[float] = None
    pucch_bler_avg: Optional[float] = None
    rssi_p1_dbm: Optional[float] = None
    rssi_p2_dbm: Optional[float] = None
    rssi_p3_dbm: Optional[float] = None
    rssi_p4_dbm: Optional[float] = None
    rssi_avg_dbm: Optional[float] = None
    delta_ports_db: Optional[float] = None
    ni_prb_profile: Optional[NiPrbProfile] = None
    harq_dtx_rate: Optional[float] = None
    harq_nack_rate: Optional[float] = None
    ul_thp_mbps: Optional[float] = None
    dl_thp_mbps: Optional[float] = None
    pdcch_util: Optional[float] = None
    cce_blocking_rate: Optional[float] = None
    rlc_buffer_usage: Optional[float] = None
    ul_rlc_retx_rate: Optional[float] = None
    sr_users: Optional[int] = None
    cqi_users: Optional[int] = None
    pucch_resource_pressure: Optional[float] = None
    traffic_corr: Optional[float] = None
    data_quality_flags: Optional[List[str]] = None

    pim_class: Optional[
        Literal["PIM_DISTRIBUIDO", "TRAFFIC_BASED", "EI", "AMBIGUO", "NONE"]
    ] = None
    pim_reliability: Optional[float] = None
    worst_hour: Optional[int] = None
    ei_neighbor_match_flag: Optional[bool] = None

    irc_enabled: Optional[bool] = None
    full_4x4_irc_enabled: Optional[bool] = None
    irc_aas_fdd_enabled: Optional[bool] = None
    duct_interference_reduction_enabled: Optional[bool] = None
    duct_crs_muting_mode: Optional[Literal["NOT", "PARTIAL", "FULL"]] = None
    pim_detection_enabled: Optional[bool] = None
    pim_avoidance_enabled: Optional[bool] = None
    ul_triggered_if_mobility_enabled: Optional[bool] = None
    ul_search_threshold: Optional[float] = None
    volte_ul_triggered_mobility_enabled: Optional[bool] = None
    spifho_enabled: Optional[bool] = None
    pucch_overdimensioning_enabled: Optional[bool] = None
    dynamic_pucch_enabled: Optional[bool] = None
    icic_autonomous_enabled: Optional[bool] = None
    iflb_enabled: Optional[bool] = None
    iflb_activation_threshold_enabled: Optional[bool] = None
    ifo_enabled: Optional[bool] = None
    ivlb_enabled: Optional[bool] = None
    limited_ul_aware_iflb_enabled: Optional[bool] = None
    ul_rlc_retx_threshold_enabled: Optional[bool] = None
    decoupled_pdcch_la_enabled: Optional[bool] = None
    out_of_coverage_ul_sched_ctrl_enabled: Optional[bool] = None
    instant_uplink_access_enabled: Optional[bool] = None
    intelligent_power_emission_control_enabled: Optional[bool] = None
    multi_clustered_pusch_enabled: Optional[bool] = None

    duct_pattern_flag: Optional[bool] = None
    ampr_restriction_suspected: Optional[bool] = None
    adjacent_band_interference_suspected: Optional[bool] = None
    sr_fail_rate: Optional[float] = None
    sr_success_rate: Optional[float] = None
    cqi_report_drop_rate: Optional[float] = None

    voice_allowed_on_serving_freq: Optional[bool] = None
    emergency_location_requires: Optional[bool] = None
    qci1_active_users: Optional[int] = None
    qci1_kpi_degraded: Optional[bool] = None
    arp_high_prio_users: Optional[int] = None
    spifho_configured: Optional[bool] = None
    servOrPrioTriggeredIFHo: Optional[Literal["NONE", "QCI", "ARP"]] = None
    servOrPrioIFHoSetupBearer: Optional[bool] = None
    ul_volte_triggered_mobility_enabled: Optional[bool] = None
    ul_volte_triggered_mobility_mode: Optional[
        Literal["BLINDHO", "MEASBASEDHO"]
    ] = None

    load_imbalance_flag: Optional[bool] = None
    carrier_a_util: Optional[float] = None
    carrier_b_util: Optional[float] = None
    dl_interference_dominant: Optional[bool] = None
    emf_power_cap_flag: Optional[bool] = None
    ul_latency_sensitive: Optional[bool] = None
    spectrogram: Optional[Spectrogram] = None


class ConfigChange(BaseModel):
    feature_id: Optional[str] = None
    mo: Optional[str] = None
    param: Optional[str] = None
    value: Optional[object] = None
    note: Optional[str] = None


class ExpectedEffect(BaseModel):
    kpi: str
    target_direction: str
    note: Optional[str] = None


class RollbackPlan(BaseModel):
    what_to_revert: str


class ActionStep(BaseModel):
    title: str
    feature_id: Optional[str] = None
    config_changes: List[ConfigChange] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    conflicts: List[str] = Field(default_factory=list)
    expected_effect: List[ExpectedEffect] = Field(default_factory=list)
    verify_with: List[str] = Field(default_factory=list)
    rollback: Optional[RollbackPlan] = None
    reason_codes: List[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    category: str
    confidence: float
    severity: Literal["low", "med", "high"]
    actions: List[ActionStep]
    explanations: List[str]


class AdvisoryOutput(BaseModel):
    cell_id: str
    snapshot_day: Optional[str] = None
    recommendations: List[Recommendation]
    explanations: List[str]
    do_not_do: List[str]
    spectral_evidence: Optional[SpectrogramEvidence] = None
    affectation: Optional[AffectationSummary] = None
