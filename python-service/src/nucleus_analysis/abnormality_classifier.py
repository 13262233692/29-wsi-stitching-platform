#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
恶性异常细胞判定规则

基于病理学经验的启发式规则，对提取出的形态学特征打分。
一旦综合评分超过阈值，则标记为异常并入库 Milvus 做相似度检索。

判定维度:
  A. 圆面积比 (Circularity)
        < 0.6  → 形状高度不规则, 典型多角形/多叶核病变
        < 0.75 → 疑似不规则
  B. 边界粗糙度 (Boundary Roughness)
        > 1.8 → 多分叶、毛刺状突起 (典型: 恶性肿瘤细胞)
        > 1.4 → 边界欠光滑
  C. 长短轴比 (Aspect Ratio)
        > 2.5 → 高度纺锤形/纤维状 (提示梭形细胞肿瘤)
  D. 核内光密度方差 (Intensity Std)
        > 45  → 染色质粗糙聚集, 可能染色体异变
        > 60  → 高度怀疑染色体浓聚 (高度异型性)
  E. 综合分 = wA·A + wB·B + wC·C + wD·D, 阈值 0.5

输出:
  is_abnormal:        bool
  abnormality_score:  float [0,1]
  abnormality_tags:   List[str] 人类可读标签 (如 "polygonal", "chromatin_aggregation")
"""
from __future__ import annotations

from typing import Dict, List, Tuple

# 权重可调
W_A = 0.30   # Circularity
W_B = 0.35   # Boundary Roughness (最重要)
W_C = 0.15   # Aspect Ratio
W_D = 0.20   # Intensity Std

# 阈值
CIRCULARITY_SOFT = 0.75
CIRCULARITY_HARD = 0.60
ROUGHNESS_SOFT = 1.4
ROUGHNESS_HARD = 1.8
ASPECT_SOFT = 2.0
ASPECT_HARD = 2.5
INTENSITY_SOFT = 45
INTENSITY_HARD = 60

SCORE_THRESHOLD = 0.50


def _score_linear_low(value: float, soft: float, hard: float) -> float:
    """越小越可疑"""
    if value >= soft:
        return 0.0
    if value <= hard:
        return 1.0
    return (soft - value) / (soft - hard)


def _score_linear_high(value: float, soft: float, hard: float) -> float:
    """越大越可疑"""
    if value <= soft:
        return 0.0
    if value >= hard:
        return 1.0
    return (value - soft) / (hard - soft)


def classify_abnormality(feat: Dict) -> Dict:
    """
    对单个细胞核特征向量做异常判定

    Returns:
        {
            "is_abnormal": bool,
            "abnormality_score": float,
            "abnormality_tags": List[str],
            "sub_scores": {A, B, C, D}
        }
    """
    s_a = _score_linear_low(feat.get("circularity", 1.0), CIRCULARITY_SOFT, CIRCULARITY_HARD)
    s_b = _score_linear_high(feat.get("boundary_roughness", 1.0), ROUGHNESS_SOFT, ROUGHNESS_HARD)
    s_c = _score_linear_high(feat.get("aspect_ratio", 1.0), ASPECT_SOFT, ASPECT_HARD)
    s_d = _score_linear_high(feat.get("intensity_std", 0.0), INTENSITY_SOFT, INTENSITY_HARD)

    score = float(min(1.0, W_A * s_a + W_B * s_b + W_C * s_c + W_D * s_d))

    tags: List[str] = []
    if feat.get("circularity", 1.0) < CIRCULARITY_SOFT or feat.get("boundary_roughness", 1.0) > ROUGHNESS_SOFT:
        tags.append("polygonal")          # 多角形/多叶形
    if feat.get("boundary_roughness", 1.0) > ROUGHNESS_SOFT:
        tags.append("rough_boundary")     # 粗糙边界
    if feat.get("aspect_ratio", 1.0) > ASPECT_SOFT:
        tags.append("spindle")            # 梭形/纺锤形
    if feat.get("intensity_std", 0.0) > INTENSITY_SOFT:
        tags.append("chromatin_aggregation")  # 染色质聚集/染色体异变
    if score >= SCORE_THRESHOLD and not tags:
        tags.append("morphology_suspected")

    return {
        "is_abnormal": bool(score >= SCORE_THRESHOLD),
        "abnormality_score": round(score, 4),
        "abnormality_tags": tags,
        "sub_scores": {
            "circularity": round(s_a, 4),
            "boundary_roughness": round(s_b, 4),
            "aspect_ratio": round(s_c, 4),
            "intensity_std": round(s_d, 4),
        },
    }


def batch_classify(feature_list: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """批量分类, 返回 (全部列表, 仅异常列表)"""
    all_results = []
    abnormal_only = []
    for feat in feature_list:
        cls = classify_abnormality(feat)
        merged = {**feat, **cls}
        all_results.append(merged)
        if merged["is_abnormal"]:
            abnormal_only.append(merged)
    return all_results, abnormal_only
