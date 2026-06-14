#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
细胞核实例分割 (轻量级, 无需 GPU / 大模型)

实现策略 (纯 OpenCV + NumPy, 适合 CPU 实时处理):
  1. 颜色空间转换 RGB -> Lab
  2. a 通道反色 + 自适应阈值 (Otsu) -> 前景掩码
  3. 形态学开闭运算去噪
  4. 距离变换 + 分水岭 (Watershed) 实现粘连细胞核实例分离
  5. connectedComponentsWithStats 输出实例掩码
  6. (可选) 通过 Triton 调用训练好的 HoVer-Net / UNet 轻量模型

输出:
  - instance_mask:  uint16 ndarray, 每个像素是实例 ID (0=背景)
  - bboxes:         List[List[4]] [x, y, w, h]
  - centroids:      List[List[2]] [cx, cy]  (相对 tile 内部坐标)
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import base64
import io
import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


def _decode_b64_image(b64: str) -> np.ndarray:
    """base64 -> RGB ndarray (H, W, 3)"""
    data = base64.b64decode(b64)
    arr = np.frombuffer(data, dtype=np.uint8)
    if cv2 is not None:
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    # fallback 使用 PIL
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(img)


def segment_nuclei_opencv(
    image_rgb: np.ndarray,
    min_area: int = 80,
    max_area: int = 8000,
    use_watershed: bool = True,
) -> Dict:
    """
    基于传统计算机视觉的细胞核实例分割

    Args:
        image_rgb: (H, W, 3) uint8 RGB
        min_area:  最小细胞核面积 (像素)
        max_area:  最大细胞核面积 (像素)
        use_watershed: 是否启用分水岭处理粘连细胞核

    Returns:
        {
            "instance_mask": np.ndarray (H, W) uint16,
            "count": int,
            "bboxes": [[x,y,w,h], ...],
            "centroids": [[cx, cy], ...],
            "areas": [int, ...],
        }
    """
    if cv2 is None:
        raise RuntimeError("OpenCV (cv2) is required for nucleus segmentation")

    h, w = image_rgb.shape[:2]

    # --- 1. 颜色空间转换, 利用 Lab 的 a 通道突出紫红色细胞核 ---
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    a_channel = lab[:, :, 1]

    # --- 2. Otsu 自适应阈值 ---
    a_inv = 255 - a_channel
    blur = cv2.GaussianBlur(a_inv, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # --- 3. 形态学开闭运算去噪 ---
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel, iterations=2)

    if use_watershed:
        # --- 4. 距离变换 + 分水岭 ---
        dist = cv2.distanceTransform(closed, cv2.DIST_L2, 5)
        _, sure_fg = cv2.threshold(dist, 0.25 * dist.max(), 255, cv2.THRESH_BINARY)
        sure_fg = np.uint8(sure_fg)
        unknown = cv2.subtract(closed, sure_fg)

        num_labels, markers = cv2.connectedComponents(sure_fg)
        markers = markers + 1
        markers[unknown == 255] = 0

        # 3 通道图像用于分水岭
        markers = cv2.watershed(image_rgb if image_rgb.shape[2] == 3 else cv2.cvtColor(image_rgb, cv2.COLOR_GRAY2BGR), markers)
        # 边界(-1) 算作背景
        markers[markers <= 1] = 0
        instance_mask = markers.astype(np.uint16)
    else:
        num_labels, instance_mask, _, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
        instance_mask = instance_mask.astype(np.uint16)

    # --- 5. 统计每个实例 ---
    bboxes: List[List[int]] = []
    centroids: List[List[int]] = []
    areas: List[int] = []
    kept_ids: List[int] = []

    # ID 0 = 背景
    for inst_id in range(1, instance_mask.max() + 1):
        mask = (instance_mask == inst_id).astype(np.uint8)
        if mask.sum() == 0:
            continue
        ys, xs = np.where(mask > 0)
        x, y = int(xs.min()), int(ys.min())
        bw = int(xs.max() - xs.min() + 1)
        bh = int(ys.max() - ys.min() + 1)
        area = int(mask.sum())
        if not (min_area <= area <= max_area):
            continue
        cx = int(xs.mean())
        cy = int(ys.mean())
        bboxes.append([x, y, bw, bh])
        centroids.append([cx, cy])
        areas.append(area)
        kept_ids.append(int(inst_id))

    # --- 6. 重新编号连续 ID ---
    new_mask = np.zeros((h, w), dtype=np.uint16)
    for new_id, old_id in enumerate(kept_ids, start=1):
        new_mask[instance_mask == old_id] = new_id

    return {
        "instance_mask": new_mask,
        "count": len(kept_ids),
        "bboxes": bboxes,
        "centroids": centroids,
        "areas": areas,
    }


def segment_nuclei_triton(
    image_rgb: np.ndarray,
    triton_client=None,
    model_name: str = "nucleus_segmentation",
) -> Optional[Dict]:
    """
    可选: 通过 Triton gRPC 调用训练好的细胞核分割模型 (如 HoVer-Net-lite, UNet-MobileNet)
    triton_client 可选传入; 未传入时使用默认单例
    """
    try:
        from ..triton_client.triton_client import get_triton_client
        client = triton_client or get_triton_client()
    except Exception:
        return None

    if not client.server_live():
        return None

    try:
        # 模型输入: (N, H, W, 3) float32, 输出: (N, H, W) int64 instance mask
        h, w = image_rgb.shape[:2]
        inp = (image_rgb.astype(np.float32) / 255.0)[None, ...]
        out = client.infer(
            model_name,
            {"input": inp},
            output_names=["instance_mask"],
        )
        mask = out["instance_mask"][0].astype(np.uint16)
        # 后处理: 提取 bbox / centroid
        bboxes, centroids, areas = [], [], []
        for inst_id in range(1, mask.max() + 1):
            ys, xs = np.where(mask == inst_id)
            if len(xs) == 0:
                continue
            area = int(len(xs))
            bboxes.append([int(xs.min()), int(ys.min()),
                           int(xs.max() - xs.min() + 1),
                           int(ys.max() - ys.min() + 1)])
            centroids.append([int(xs.mean()), int(ys.mean())])
            areas.append(area)
        return {
            "instance_mask": mask,
            "count": len(bboxes),
            "bboxes": bboxes,
            "centroids": centroids,
            "areas": areas,
        }
    except Exception:
        return None


def segment_nuclei(
    image_b64: str,
    min_area: int = 80,
    max_area: int = 8000,
    prefer_triton: bool = True,
) -> Dict:
    """对外统一入口: base64 -> 实例分割结果"""
    img = _decode_b64_image(image_b64)
    result = None
    if prefer_triton:
        result = segment_nuclei_triton(img)
    if result is None:
        result = segment_nuclei_opencv(img, min_area=min_area, max_area=max_area)
    return result
