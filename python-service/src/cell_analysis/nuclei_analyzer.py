#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WSI 细胞核实例分割 + 形态学特征提取算子
=========================================
- 轻量级 U-Net 风格分割网络 (或 Triton 远端推理) 输出 instance masks
- OpenCV 纯数学解算:
    * 圆面积比 Circularity = 4 * π * Area / Perimeter^2
    * 长短轴比 AspectRatio  = MajorAxis / MinorAxis
    * 边界粗糙度 Roughness    = Perimeter / ConvexHullPerimeter
- 异常检测: 多角形病变 / 染色体异变聚集判定
- 输出 128 维特征向量 + 元数据供 Milvus 持久化
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import sys
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

# OpenCV - 纯数学形态学计算
try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


# ======================================================================
# 数据结构
# ======================================================================
@dataclass
class NucleusFeature:
    """单细胞核形态学特征"""
    cell_id: int
    centroid_x: float          # 物理空间 X (全玻片坐标系, 已叠加 tile 偏移)
    centroid_y: float          # 物理空间 Y
    bbox_x: int
    bbox_y: int
    bbox_w: int
    bbox_h: int
    area: float                # 像素面积
    perimeter: float           # 像素周长
    convex_perimeter: float    # 凸包周长
    major_axis: float          # 拟合椭圆长轴
    minor_axis: float          # 拟合椭圆短轴
    orientation: float         # 长轴方向角 (rad)
    circularity: float         # 圆面积比 4πA/P² (0,1], 1=完美圆
    aspect_ratio: float        # 长短轴比例 ≥1, 越大越细长
    solidity: float            # 面凸性 Area / ConvexArea
    roughness: float           # 边界粗糙度 P / ConvexP ≥1, 越大越毛糙
    mean_intensity: float      # 平均灰度 (可扩展到 RGB 三通道)
    is_abnormal: bool          # 综合异常判定
    abnormal_reasons: List[str]
    feature_vector: List[float]  # 128-dim, 供 Milvus 检索


@dataclass
class CellAnalysisResult:
    tile_index: Tuple[int, int]
    tile_offset: Tuple[int, int]     # 全玻片坐标系下 tile 左上角
    tile_size: int
    scale_factor: int
    nuclei: List[NucleusFeature]
    abnormal_count: int
    total_count: int
    density: float                   # cells / mm^2 (近似, 基于 pixel_size)
    anomaly_score: float             # [0,1] tile 综合异常评分
    thumbnail_b64: Optional[str]     # 叠加 mask 的缩略图 (可选)


# ======================================================================
# 轻量级实例分割 (可替换为 Triton / HoverNet / CellPose)
# ======================================================================
class NucleiSegmentor:
    """轻量细胞核实例分割。

    默认实现:
        - RGB -> 灰度 -> Otsu 阈值 -> 形态学开闭 -> 距离变换分水岭
        - 在无 GPU / 无模型环境下仍可产出可解释的 instance masks
    生产环境建议替换为 Triton 上部署的 HoverNet / CellPose / Mask R-CNN
    """

    def __init__(self, min_area: int = 80, max_area: int = 40000):
        self.min_area = min_area
        self.max_area = max_area

    def segment(self, img_rgb: np.ndarray) -> np.ndarray:
        """返回 instance label map (uint32), 0=背景"""
        if cv2 is None:
            return self._fallback_segment(img_rgb)

        gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
        # 细胞核通常染色深 -> 取反
        _, fg = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        # 形态学
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, kernel, iterations=1)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, kernel, iterations=1)

        # 距离变换分水岭
        dist = cv2.distanceTransform(fg, cv2.DIST_L2, 5)
        _, sure = cv2.threshold(dist, 0.4 * dist.max(), 255, cv2.THRESH_BINARY)
        sure = np.uint8(sure)
        unknown = cv2.subtract(fg, sure)
        _, markers = cv2.connectedComponents(sure)
        markers = markers + 1
        markers[unknown == 255] = 0
        markers = cv2.watershed(
            cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR), markers
        )

        labels = np.zeros_like(markers, dtype=np.uint32)
        uid = 1
        for v in np.unique(markers):
            if v <= 1:
                continue
            mask = (markers == v).astype(np.uint8)
            area = int(mask.sum())
            if self.min_area <= area <= self.max_area:
                labels[mask > 0] = uid
                uid += 1
        return labels

    # ------------------------------------------------------------------
    def _fallback_segment(self, img_rgb: np.ndarray) -> np.ndarray:
        """无 OpenCV 时用 PIL + NumPy 简易连通域"""
        gray = (
            0.2989 * img_rgb[..., 0]
            + 0.5870 * img_rgb[..., 1]
            + 0.1140 * img_rgb[..., 2]
        )
        thr = gray.mean() - gray.std() * 0.3
        fg = (gray < thr).astype(np.uint8)
        labels = _connected_components(fg)
        return labels


def _connected_components(mask: np.ndarray) -> np.ndarray:
    """两趟扫描连通域 (最小实现)"""
    h, w = mask.shape
    out = np.zeros((h, w), dtype=np.uint32)
    parent = [0]
    next_id = 1
    for y in range(h):
        for x in range(w):
            if mask[y, x] == 0:
                continue
            neighbors = []
            if y > 0 and out[y - 1, x] > 0:
                neighbors.append(out[y - 1, x])
            if x > 0 and out[y, x - 1] > 0:
                neighbors.append(out[y, x - 1])
            if not neighbors:
                out[y, x] = next_id
                parent.append(next_id)
                next_id += 1
            else:
                root = min(_find_root(parent, n) for n in neighbors)
                out[y, x] = root
                for n in neighbors:
                    _union(parent, root, n)
    for y in range(h):
        for x in range(w):
            if out[y, x] > 0:
                out[y, x] = _find_root(parent, int(out[y, x]))
    # 重新编号
    uniq = {v: i + 1 for i, v in enumerate(np.unique(out)) if v > 0}
    new_out = np.zeros_like(out)
    for v, i in uniq.items():
        new_out[out == v] = i
    return new_out


def _find_root(parent: List[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: List[int], a: int, b: int) -> None:
    ra, rb = _find_root(parent, a), _find_root(parent, b)
    if ra != rb:
        parent[rb] = ra


# ======================================================================
# 形态学特征提取 (OpenCV 纯数学)
# ======================================================================
class MorphologyFeatureExtractor:
    """基于 OpenCV findContours / fitEllipse / convexHull / arcLength 的
    纯数学解算器。"""

    # 异常阈值 (可调)
    ABNORMAL_CIRCULARITY_LOW = 0.55   # 偏离圆形
    ABNORMAL_ASPECT_RATIO_HIGH = 2.2  # 过度细长 (多角形)
    ABNORMAL_ROUGHNESS_HIGH = 1.35    # 边界毛糙
    ABNORMAL_SOLIDITY_LOW = 0.75
    ABNORMAL_AREA_MIN = 150
    ABNORMAL_AREA_MAX = 15000

    def __init__(self, scale_factor: int = 4, pixel_size_um: float = 0.25):
        self.scale_factor = scale_factor
        self.pixel_size_um = pixel_size_um

    # ------------------------------------------------------------------
    def extract(
        self,
        labels: np.ndarray,
        img_rgb: np.ndarray,
        offset_xy: Tuple[int, int] = (0, 0),
    ) -> List[NucleusFeature]:
        h, w = labels.shape
        features: List[NucleusFeature] = []
        cell_id = 0
        for uid in np.unique(labels):
            if uid == 0:
                continue
            mask = (labels == uid).astype(np.uint8)
            ys, xs = np.where(mask > 0)
            if len(xs) < 10:
                continue

            if cv2 is not None:
                contours, _ = cv2.findContours(
                    mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
                )
                if not contours:
                    continue
                cnt = contours[0]
                area = float(cv2.contourArea(cnt))
                if area < 4:
                    continue
                perimeter = float(cv2.arcLength(cnt, True))
                hull = cv2.convexHull(cnt)
                convex_perimeter = float(cv2.arcLength(hull, True)) or 1e-6
                hull_area = float(cv2.contourArea(hull)) or 1e-6
                solidity = area / hull_area

                if len(cnt) >= 5:
                    ellipse = cv2.fitEllipse(cnt)
                    (cx, cy), (ma, mi), angle = ellipse
                    major = max(ma, mi)
                    minor = min(ma, mi) or 1e-6
                else:
                    cx, cy = xs.mean(), ys.mean()
                    major = max(xs.max() - xs.min(), ys.max() - ys.min())
                    minor = max(1.0, min(xs.max() - xs.min(), ys.max() - ys.min()))
                    angle = 0.0
            else:
                # NumPy fallback
                area = float(mask.sum())
                perimeter = float(approx_perimeter(mask))
                convex_perimeter = perimeter
                solidity = 1.0
                cx, cy = xs.mean(), ys.mean()
                major = float(max(xs.max() - xs.min(), ys.max() - ys.min())) or 1e-6
                minor = float(max(1.0, min(xs.max() - xs.min(), ys.max() - ys.min())))
                angle = 0.0

            # 纯数学指标
            circularity = (4.0 * math.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0.0
            aspect_ratio = major / minor if minor > 0 else 1.0
            roughness = perimeter / convex_perimeter if convex_perimeter > 0 else 1.0

            # 平均灰度
            mean_intensity = float(img_rgb[mask > 0].mean())

            # 异常判定
            reasons: List[str] = []
            if circularity < self.ABNORMAL_CIRCULARITY_LOW:
                reasons.append("low_circularity")
            if aspect_ratio > self.ABNORMAL_ASPECT_RATIO_HIGH:
                reasons.append("high_aspect_ratio")
            if roughness > self.ABNORMAL_ROUGHNESS_HIGH:
                reasons.append("high_roughness")
            if solidity < self.ABNORMAL_SOLIDITY_LOW:
                reasons.append("low_solidity")
            if area < self.ABNORMAL_AREA_MIN or area > self.ABNORMAL_AREA_MAX:
                reasons.append("abnormal_size")
            is_abnormal = len(reasons) >= 2

            # 特征向量 (128-dim)
            fv = build_feature_vector(
                area=area,
                perimeter=perimeter,
                circularity=circularity,
                aspect_ratio=aspect_ratio,
                solidity=solidity,
                roughness=roughness,
                major=major,
                minor=minor,
                mean_intensity=mean_intensity,
                orientation=float(angle),
            )

            bbox_x, bbox_y = int(xs.min()), int(ys.min())
            bbox_w, bbox_h = int(xs.max() - bbox_x), int(ys.max() - bbox_y)

            features.append(
                NucleusFeature(
                    cell_id=cell_id,
                    centroid_x=float(cx + offset_xy[0]),
                    centroid_y=float(cy + offset_xy[1]),
                    bbox_x=bbox_x + offset_xy[0],
                    bbox_y=bbox_y + offset_xy[1],
                    bbox_w=bbox_w,
                    bbox_h=bbox_h,
                    area=area,
                    perimeter=perimeter,
                    convex_perimeter=convex_perimeter,
                    major_axis=float(major),
                    minor_axis=float(minor),
                    orientation=float(angle),
                    circularity=float(circularity),
                    aspect_ratio=float(aspect_ratio),
                    solidity=float(solidity),
                    roughness=float(roughness),
                    mean_intensity=mean_intensity,
                    is_abnormal=is_abnormal,
                    abnormal_reasons=reasons,
                    feature_vector=[float(x) for x in fv],
                )
            )
            cell_id += 1
        return features


def approx_perimeter(mask: np.ndarray) -> float:
    """无 OpenCV 时的周长估算: 统计 4-邻域变化边数"""
    h, w = mask.shape
    p = 0.0
    for y in range(h):
        for x in range(w):
            if mask[y, x] == 0:
                continue
            if y == 0 or mask[y - 1, x] == 0:
                p += 1
            if y == h - 1 or mask[y + 1, x] == 0:
                p += 1
            if x == 0 or mask[y, x - 1] == 0:
                p += 1
            if x == w - 1 or mask[y, x + 1] == 0:
                p += 1
    return p * 0.886  # 修正因子


def build_feature_vector(
    area: float,
    perimeter: float,
    circularity: float,
    aspect_ratio: float,
    solidity: float,
    roughness: float,
    major: float,
    minor: float,
    mean_intensity: float,
    orientation: float,
) -> np.ndarray:
    """基于 10 个基础指标扩展成 128 维 (统计矩 + 三角基)"""
    base = np.array(
        [
            area,
            perimeter,
            circularity,
            aspect_ratio,
            solidity,
            roughness,
            major,
            minor,
            mean_intensity,
            orientation,
        ],
        dtype=np.float32,
    )
    # 归一化 (近似)
    base = np.tanh(base / np.array(
        [5000.0, 500.0, 1.0, 3.0, 1.0, 2.0, 200.0, 100.0, 180.0, 3.14],
        dtype=np.float32,
    ))
    feats = [base]
    # 2 次矩
    feats.append(base ** 2)
    # 3 次矩
    feats.append(base ** 3)
    # sin/cos 基 (orientation 相关)
    feats.append(np.sin(base * np.pi))
    feats.append(np.cos(base * np.pi))
    # 两两乘积 (45)
    cross = []
    for i in range(len(base)):
        for j in range(i + 1, len(base)):
            cross.append(base[i] * base[j])
    feats.append(np.array(cross, dtype=np.float32))
    out = np.concatenate(feats).astype(np.float32)
    # 截取/填充到 128
    if len(out) > 128:
        out = out[:128]
    elif len(out) < 128:
        out = np.pad(out, (0, 128 - len(out)), mode="edge")
    # L2 归一
    norm = np.linalg.norm(out) + 1e-8
    return out / norm


# ======================================================================
# 入口
# ======================================================================
def analyze_tile_from_base64(
    image_b64: str,
    tile_row: int,
    tile_col: int,
    tile_size: int = 512,
    overlap: int = 32,
    scale_factor: int = 4,
) -> Dict:
    """对单张高分辨率 tile 做分割 + 特征提取"""
    raw = base64.b64decode(image_b64)
    img = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))

    segmentor = NucleiSegmentor()
    labels = segmentor.segment(img)

    offset_x = tile_col * (tile_size - overlap) * scale_factor
    offset_y = tile_row * (tile_size - overlap) * scale_factor

    extractor = MorphologyFeatureExtractor(scale_factor=scale_factor)
    nuclei = extractor.extract(labels, img, offset_xy=(offset_x, offset_y))

    abnormal = [n for n in nuclei if n.is_abnormal]
    tile_area_um2 = (img.shape[0] * img.shape[1]) * (0.25 ** 2)
    density = len(nuclei) / max(tile_area_um2, 1.0) * 1e6  # cells per mm²

    anomaly_score = 0.0
    if nuclei:
        anomaly_score = (
            0.5 * (len(abnormal) / len(nuclei))
            + 0.25 * min(1.0, density / 8000.0)
            + 0.25
            * float(
                np.mean([1 - n.circularity for n in abnormal])
                if abnormal
                else 0.0
            )
        )

    result = CellAnalysisResult(
        tile_index=(tile_row, tile_col),
        tile_offset=(offset_x, offset_y),
        tile_size=img.shape[1],
        scale_factor=scale_factor,
        nuclei=nuclei,
        abnormal_count=len(abnormal),
        total_count=len(nuclei),
        density=float(density),
        anomaly_score=float(min(1.0, anomaly_score)),
        thumbnail_b64=None,
    )
    return asdict(result)


def main_cli() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", default="analyze_tile")
    parser.add_argument("--tiles_json", type=str, default=None)
    parser.add_argument("--tile_image_b64", type=str, default=None)
    parser.add_argument("--tile_row", type=int, default=0)
    parser.add_argument("--tile_col", type=int, default=0)
    parser.add_argument("--tile_size", type=int, default=512)
    parser.add_argument("--overlap", type=int, default=32)
    parser.add_argument("--scale_factor", type=int, default=4)
    parser.add_argument("--output_json", type=str, default=None)
    args = parser.parse_args()

    if args.action == "analyze_tile" and args.tile_image_b64:
        res = analyze_tile_from_base64(
            args.tile_image_b64,
            tile_row=args.tile_row,
            tile_col=args.tile_col,
            tile_size=args.tile_size,
            overlap=args.overlap,
            scale_factor=args.scale_factor,
        )
        out_s = json.dumps(res, ensure_ascii=False)
        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                f.write(out_s)
        else:
            print(out_s)
        return

    if args.action == "analyze_batch" and args.tiles_json:
        with open(args.tiles_json, "r", encoding="utf-8") as f:
            tiles = json.load(f)
        batch = []
        for t in tiles:
            r = analyze_tile_from_base64(
                t["image_data"],
                tile_row=t.get("row", 0),
                tile_col=t.get("col", 0),
                tile_size=args.tile_size,
                overlap=args.overlap,
                scale_factor=args.scale_factor,
            )
            batch.append(r)
        print(json.dumps({"results": batch}, ensure_ascii=False))
        return

    print(json.dumps({"error": "unknown action or missing inputs"}))


if __name__ == "__main__":
    main_cli()
