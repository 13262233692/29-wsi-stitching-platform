#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高斯距离加权混合 (Gaussian Blending) 拼接算法
用于对带重叠区域的超分图像块进行边缘平滑无缝拼接
"""

import json
import sys
import os
import argparse
import base64
from io import BytesIO
from typing import Dict, List, Tuple, Any, Optional

import numpy as np

try:
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "Pillow 未安装"}), file=sys.stdout)
    sys.exit(1)


def generate_gaussian_weight(
    tile_size: Tuple[int, int],
    overlap: int,
    sigma_scale: float = 0.3,
) -> np.ndarray:
    """
    生成二维高斯权重矩阵
    高斯函数以中心为峰值，边缘平滑衰减为 0
    在重叠区域使用距离加权

    参数:
        tile_size: (height, width) 切片尺寸
        overlap: 重叠像素数
        sigma_scale: sigma = tile_size * sigma_scale

    返回:
        weight_map: (H, W) float32 [0, 1]
    """
    h, w = tile_size
    center_y, center_x = h / 2.0, w / 2.0
    sigma_y = h * sigma_scale
    sigma_x = w * sigma_scale

    y = np.arange(h, dtype=np.float32)[:, None]
    x = np.arange(w, dtype=np.float32)[None, :]

    dist_sq = ((y - center_y) ** 2) / (2 * sigma_y ** 2) + \
              ((x - center_x) ** 2) / (2 * sigma_x ** 2)
    gaussian = np.exp(-dist_sq).astype(np.float32)

    gaussian = gaussian / gaussian.max()

    if overlap > 0:
        fade = np.ones((h, w), dtype=np.float32)
        if overlap < h // 2:
            top = np.linspace(0, 1, overlap, dtype=np.float32)
            bottom = np.linspace(1, 0, overlap, dtype=np.float32)
            for i in range(overlap):
                fade[i, :] *= top[i]
                fade[h - 1 - i, :] *= bottom[i]
        if overlap < w // 2:
            left = np.linspace(0, 1, overlap, dtype=np.float32)
            right = np.linspace(1, 0, overlap, dtype=np.float32)
            for j in range(overlap):
                fade[:, j] *= left[j]
                fade[:, w - 1 - j] *= right[j]
        weight = gaussian * fade
    else:
        weight = gaussian

    weight = weight / weight.max() if weight.max() > 0 else weight
    return weight


def decode_base64_image(b64_str: str) -> np.ndarray:
    img = Image.open(BytesIO(base64.b64decode(b64_str))).convert("RGB")
    return np.array(img, dtype=np.float32) / 255.0


def encode_numpy_image(arr: np.ndarray, fmt: str = "PNG") -> str:
    arr = np.clip(arr, 0, 1)
    img = Image.fromarray((arr * 255).astype(np.uint8), mode="RGB")
    buffer = BytesIO()
    img.save(buffer, format=fmt)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


class GaussianBlender:
    """高斯距离加权混合拼接器"""

    def __init__(
        self,
        canvas_size: Tuple[int, int],
        tile_size: Tuple[int, int],
        overlap: int,
        scale_factor: int = 1,
    ):
        """
        参数:
            canvas_size: 最终画布尺寸 (height, width)
            tile_size: 单个切片尺寸 (h, w) (原始尺寸，不含 scale)
            overlap: 原始重叠像素数
            scale_factor: 超分放大倍数
        """
        self.sr_h = canvas_size[0]
        self.sr_w = canvas_size[1]
        self.tile_h = tile_size[0] * scale_factor
        self.tile_w = tile_size[1] * scale_factor
        self.overlap = overlap * scale_factor
        self.scale_factor = scale_factor
        self.effective_step = (tile_size[0] - overlap) * scale_factor

        self.canvas = np.zeros((self.sr_h, self.sr_w, 3), dtype=np.float64)
        self.weight_sum = np.zeros((self.sr_h, self.sr_w), dtype=np.float64)
        self.weight_map = generate_gaussian_weight(
            (self.tile_h, self.tile_w), self.overlap
        )

    def add_tile(
        self,
        image_arr: np.ndarray,
        row: int,
        col: int,
    ) -> None:
        """
        将一个超分后的切片贴入画布，使用高斯权重在重叠区混合

        参数:
            image_arr: (H, W, 3) float32 [0, 1] 超分后图像
            row: 网格行索引
            col: 网格列索引
        """
        tile_h, tile_w = image_arr.shape[:2]
        y0 = row * self.effective_step
        x0 = col * self.effective_step
        y1 = min(y0 + tile_h, self.sr_h)
        x1 = min(x0 + tile_w, self.sr_w)

        actual_h = y1 - y0
        actual_w = x1 - x0

        tile_crop = image_arr[:actual_h, :actual_w, :]
        weight_crop = self.weight_map[:actual_h, :actual_w]
        weight_crop_3c = weight_crop[:, :, None]

        self.canvas[y0:y1, x0:x1, :] += tile_crop * weight_crop_3c
        self.weight_sum[y0:y1, x0:x1] += weight_crop

    def get_blended_canvas(self) -> np.ndarray:
        """获取最终拼接后的画布 (归一化权重)"""
        safe_weight = np.where(self.weight_sum > 1e-6, self.weight_sum, 1.0)
        blended = self.canvas / safe_weight[:, :, None]
        return np.clip(blended, 0.0, 1.0).astype(np.float32)


def blend_tiles(
    tiles: List[Dict[str, Any]],
    total_width: int,
    total_height: int,
    tile_size: int = 512,
    overlap: int = 32,
    scale_factor: int = 4,
) -> Dict[str, Any]:
    """
    对一批带坐标信息的切片执行高斯混合拼接

    参数:
        tiles: [{row, col, width, height, image_data}]
        total_width/height: 原始画布尺寸 (不含 scale)
    """
    sr_total_w = total_width * scale_factor
    sr_total_h = total_height * scale_factor

    blender = GaussianBlender(
        canvas_size=(sr_total_h, sr_total_w),
        tile_size=(tile_size, tile_size),
        overlap=overlap,
        scale_factor=scale_factor,
    )

    for tile in tiles:
        img = decode_base64_image(tile["image_data"])
        blender.add_tile(img, tile["row"], tile["col"])

    result = blender.get_blended_canvas()
    return {
        "image_data": encode_numpy_image(result),
        "width": sr_total_w,
        "height": sr_total_h,
    }


def main():
    parser = argparse.ArgumentParser(description="高斯混合拼接算法")
    parser.add_argument("--action", type=str, required=True,
                        choices=["blend", "demo_weight"])
    parser.add_argument("--tiles_json", type=str, default=None)
    parser.add_argument("--total_width", type=int, default=4096)
    parser.add_argument("--total_height", type=int, default=4096)
    parser.add_argument("--tile_size", type=int, default=512)
    parser.add_argument("--overlap", type=int, default=32)
    parser.add_argument("--scale_factor", type=int, default=4)
    parser.add_argument("--output_path", type=str, default=None)

    args = parser.parse_args()

    try:
        if args.action == "demo_weight":
            w = generate_gaussian_weight((args.tile_size, args.tile_size), args.overlap)
            w_img = (w * 255).astype(np.uint8)
            img = Image.fromarray(w_img, mode="L")
            if args.output_path:
                img.save(args.output_path)
                print(json.dumps({"saved": args.output_path, "shape": list(w.shape)}))
            else:
                buffer = BytesIO()
                img.save(buffer, format="PNG")
                print(json.dumps({
                    "weight_b64": base64.b64encode(buffer.getvalue()).decode(),
                    "shape": list(w.shape),
                }))
        elif args.action == "blend":
            if not args.tiles_json:
                raise ValueError("blend 模式需提供 --tiles_json")
            with open(args.tiles_json, "r", encoding="utf-8") as f:
                tiles = json.load(f)
            result = blend_tiles(
                tiles, args.total_width, args.total_height,
                args.tile_size, args.overlap, args.scale_factor
            )
            if args.output_path:
                img = Image.open(BytesIO(base64.b64decode(result["image_data"])))
                img.save(args.output_path)
                print(json.dumps({
                    "saved": args.output_path,
                    "width": result["width"],
                    "height": result["height"],
                }))
            else:
                print(json.dumps({
                    "width": result["width"],
                    "height": result["height"],
                    "image_data": result["image_data"],
                }))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
