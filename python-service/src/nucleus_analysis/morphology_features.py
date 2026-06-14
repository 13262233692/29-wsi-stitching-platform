#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
细胞核形态学特征提取算子 (纯数学 OpenCV 解算)

对每个细胞核实例掩码, 计算以下形状描述子 (Shape Descriptors):

  1. 面积 (Area)
  2. 周长 (Perimeter)
  3. 圆面积比 / Circularity = 4π · Area / Perimeter²
        越接近 1 → 越近似完美圆 (典型: 正常上皮/淋巴细胞)
        越小    → 形状越不规则 (典型: 恶性异形细胞)
  4. 长短轴比 / Aspect Ratio = MajorAxis / MinorAxis
        通过拟合椭圆 (fitEllipse) 得到
        越接近 1 → 越圆; 越大 → 越细长呈纤维状或纺锤状
  5. 椭圆拟合度 / Solidity = Area / ConvexHullArea
        反映核边界的平滑程度
  6. 边界粗糙度 / Boundary Roughness
        = 实际周长 / 凸包周长 (Convex Hull Perimeter)
        越接近 1 → 越光滑; 越大 → 多分叶、多角形 (提示恶性病变)
  7. 等效圆直径 / ECD = 2·sqrt(Area/π)
  8. 矩形度 / Rectangularity = Area / (BoundingBox w·h)
  9. 分形维数近似 / FractalApprox
        通过盒计数法 (Box-Counting) 在多尺度下计算, 表征边界复杂度
  10. 核内光密度方差 (若提供原图)
        可间接反映染色质分布、染色体异变聚集

输出特征向量: 10-D float32 归一化特征 (用于 Milvus 向量相似度检索)
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import math
import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


# ---------------------------------------------------------------------------
# 单一细胞核掩码 -> 形态学特征
# ---------------------------------------------------------------------------
def extract_shape_features(
    mask_bin: np.ndarray,
    intensity_patch: Optional[np.ndarray] = None,
) -> Dict:
    """
    Args:
        mask_bin:        (H, W) uint8, 单细胞核二值掩码 (255=前景, 0=背景)
        intensity_patch: (H, W) uint8, 与 mask 同尺寸的灰度图 (用于核内染色质特征)

    Returns:
        Dict with keys:
            area, perimeter, circularity,
            major_axis, minor_axis, aspect_ratio,
            solidity, boundary_roughness, ecd, rectangularity,
            fractal_dim, intensity_std, feature_vector (12-D)
    """
    if cv2 is None:
        raise RuntimeError("OpenCV (cv2) is required for shape feature extraction")

    # --- 1. 面积 & 轮廓 ---
    contours, _ = cv2.findContours(
        mask_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
    )
    if not contours:
        return _empty_features()
    contour = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(contour))
    if area < 4:
        return _empty_features()
    perimeter = float(cv2.arcLength(contour, closed=True))
    if perimeter < 1e-6:
        perimeter = 1e-6

    # --- 2. 圆面积比 / Circularity ---
    circularity = (4.0 * math.pi * area) / (perimeter * perimeter)
    circularity = float(min(circularity, 1.0))

    # --- 3. 椭圆拟合 -> 长短轴 ---
    if len(contour) >= 5:
        (_, _), (ma, mi), _ = cv2.fitEllipse(contour)
        major_axis = float(max(ma, mi))
        minor_axis = float(min(ma, mi))
    else:
        x, y, w, h = cv2.boundingRect(contour)
        major_axis = float(max(w, h))
        minor_axis = float(min(w, h))
    minor_axis = max(minor_axis, 1.0)
    aspect_ratio = float(major_axis / minor_axis)

    # --- 4. 凸包 ---
    hull = cv2.convexHull(contour)
    hull_area = float(max(cv2.contourArea(hull), 1.0))
    hull_perimeter = float(max(cv2.arcLength(hull, closed=True), 1.0))

    # Solidity = Area / 凸包面积
    solidity = float(min(area / hull_area, 1.0))
    # Boundary Roughness = 实际周长 / 凸包周长
    boundary_roughness = float(perimeter / hull_perimeter)

    # --- 5. 等效圆直径 ECD ---
    ecd = float(2.0 * math.sqrt(area / math.pi))

    # --- 6. 矩形度 ---
    x, y, w, h = cv2.boundingRect(contour)
    bbox_area = float(max(w * h, 1.0))
    rectangularity = float(min(area / bbox_area, 1.0))

    # --- 7. 盒计数分形维数 (Fractal Dimension 近似) ---
    fractal_dim = _box_counting_dim(mask_bin)

    # --- 8. 核内光密度方差 (反映染色质聚集) ---
    intensity_std = 0.0
    if intensity_patch is not None:
        vals = intensity_patch[mask_bin > 0]
        if len(vals) > 0:
            intensity_std = float(np.std(vals))

    # --- 9. 12-D 特征向量 (标准化范围) ---
    fv = _normalize_feature_vector([
        area / 10000.0,            # 归一化面积 (典型 0-1)
        perimeter / 2000.0,        # 归一化周长
        circularity,               # [0,1]
        major_axis / 500.0,        # 归一化长轴
        aspect_ratio / 10.0,       # 归一化长短轴比
        solidity,                  # [0,1]
        min(boundary_roughness, 5.0) / 5.0,  # 粗糙度 -> [0,1]
        ecd / 500.0,               # 归一化等效圆直径
        rectangularity,            # [0,1]
        fractal_dim / 2.0,         # 分形维 1~2 -> [0,1]
        intensity_std / 80.0,      # 染色质密度方差 -> [0,1]
        circularity * (1.0 - min(boundary_roughness, 3.0) / 3.0),  # 综合平滑度
    ])

    return {
        "area": area,
        "perimeter": perimeter,
        "circularity": round(circularity, 6),
        "major_axis": round(major_axis, 3),
        "minor_axis": round(minor_axis, 3),
        "aspect_ratio": round(aspect_ratio, 4),
        "solidity": round(solidity, 6),
        "boundary_roughness": round(boundary_roughness, 4),
        "ecd": round(ecd, 3),
        "rectangularity": round(rectangularity, 6),
        "fractal_dim": round(fractal_dim, 4),
        "intensity_std": round(intensity_std, 3),
        "feature_vector": fv,
        "bbox": [int(x), int(y), int(w), int(h)],
    }


def _empty_features() -> Dict:
    return {
        "area": 0.0, "perimeter": 0.0, "circularity": 0.0,
        "major_axis": 0.0, "minor_axis": 0.0, "aspect_ratio": 0.0,
        "solidity": 0.0, "boundary_roughness": 0.0, "ecd": 0.0,
        "rectangularity": 0.0, "fractal_dim": 0.0, "intensity_std": 0.0,
        "feature_vector": [0.0] * 12, "bbox": [0, 0, 0, 0],
    }


def _normalize_feature_vector(vec: List[float]) -> List[float]:
    """裁剪到 [0, 1] + 转 float32 列表, 作为 Milvus 向量"""
    return [float(max(0.0, min(1.0, v))) for v in vec]


def _box_counting_dim(mask_bin: np.ndarray, min_box: int = 2, max_box: int = 32) -> float:
    """
    盒计数法估计分形维数 D (Minkowski-Bouligand dimension)
    D = lim_{s→0} log N(s) / log(1/s)
    s: box 大小, N(s): 覆盖前景所需 box 数量
    """
    h, w = mask_bin.shape[:2]
    sizes = []
    counts = []
    s = min_box
    while s <= max_box and s < min(h, w):
        # 二值图按 s 步长切片
        h_count = math.ceil(h / s)
        w_count = math.ceil(w / s)
        n = 0
        for i in range(h_count):
            for j in range(w_count):
                patch = mask_bin[i * s : (i + 1) * s, j * s : (j + 1) * s]
                if (patch > 0).any():
                    n += 1
        if n > 0:
            sizes.append(1.0 / s)
            counts.append(n)
        s *= 2
    if len(sizes) < 2:
        return 1.0
    # 最小二乘拟合 D = slope(log N, log 1/s)
    log_s = np.log(np.array(sizes, dtype=np.float64))
    log_n = np.log(np.array(counts, dtype=np.float64))
    try:
        slope, _ = np.polyfit(log_s, log_n, 1)
        return float(max(1.0, min(2.0, slope)))
    except Exception:
        return 1.0


# ---------------------------------------------------------------------------
# 批量提取: 一张 tile 上所有细胞核
# ---------------------------------------------------------------------------
def extract_all_nuclei_features(
    image_rgb: np.ndarray,
    seg_result: Dict,
) -> List[Dict]:
    """
    Args:
        image_rgb:  (H, W, 3) uint8 原始 tile
        seg_result: segment_nuclei() 的输出

    Returns:
        List of per-nucleus feature dicts, 附加:
            - inst_id:  该 tile 内的实例序号 (1-based)
            - centroid: [cx, cy]  tile 内坐标
    """
    if cv2 is None:
        raise RuntimeError("OpenCV is required")

    mask = seg_result["instance_mask"]
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    feats: List[Dict] = []
    for i, (cx, cy) in enumerate(seg_result["centroids"]):
        inst_id = i + 1
        if inst_id > mask.max():
            continue
        bin_mask = ((mask == inst_id).astype(np.uint8)) * 255
        bbox = seg_result["bboxes"][i]
        x, y, w, h = bbox
        x0 = max(0, x - 2); x1 = min(image_rgb.shape[1], x + w + 2)
        y0 = max(0, y - 2); y1 = min(image_rgb.shape[0], y + h + 2)
        patch_mask = bin_mask[y0:y1, x0:x1]
        patch_gray = gray[y0:y1, x0:x1]
        f = extract_shape_features(patch_mask, intensity_patch=patch_gray)
        f["inst_id"] = inst_id
        f["centroid"] = [int(cx), int(cy)]
        feats.append(f)
    return feats
