#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WSI 全玻片图像读取脚本
封装 OpenSlide 库，支持滑窗裁剪为 512x512 带重叠区域的图像块
"""

import argparse
import json
import sys
import base64
import os
from io import BytesIO
from typing import Dict, List, Any

try:
    import openslide
    from openslide import OpenSlide, OpenSlideError
except ImportError:
    print(json.dumps({"error": "OpenSlide 未安装，请先安装 openslide-python"}), file=sys.stdout)
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "Pillow 未安装，请先安装 Pillow"}), file=sys.stdout)
    sys.exit(1)


def encode_image_base64(img: Image.Image, fmt: str = "PNG") -> str:
    """将 PIL Image 编码为 Base64 字符串"""
    buffer = BytesIO()
    img.save(buffer, format=fmt)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def get_slide_info(file_path: str, level: int = 0) -> Dict[str, Any]:
    """获取 WSI 图像的元数据信息"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    with OpenSlide(file_path) as slide:
        level_count = slide.level_count
        levels_info = []
        for lv in range(level_count):
            w, h = slide.level_dimensions[lv]
            ds = slide.level_downsamples[lv]
            levels_info.append({
                "level": lv,
                "width": w,
                "height": h,
                "downsample": ds,
            })

        metadata = {}
        for key, value in slide.properties.items():
            metadata[key] = str(value)

        return {
            "file_path": file_path,
            "level_count": level_count,
            "levels": levels_info,
            "metadata": metadata,
        }


def read_tile(
    file_path: str,
    x: int,
    y: int,
    width: int,
    height: int,
    level: int = 0,
) -> Dict[str, Any]:
    """读取指定区域的切片"""
    with OpenSlide(file_path) as slide:
        if level >= slide.level_count:
            raise ValueError(f"无效的金字塔层级: {level}, 最大: {slide.level_count - 1}")

        region = slide.read_region((x, y), level, (width, height))
        if region.mode != "RGB":
            region = region.convert("RGB")

        return {
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "level": level,
            "image_data": encode_image_base64(region),
        }


def read_batch_tiles(
    file_path: str,
    tile_size: int = 512,
    overlap: int = 32,
    level: int = 0,
) -> Dict[str, Any]:
    """批量滑窗读取所有切片"""
    with OpenSlide(file_path) as slide:
        if level >= slide.level_count:
            raise ValueError(f"无效的金字塔层级: {level}")

        total_width, total_height = slide.level_dimensions[level]
        effective_step = tile_size - overlap
        grid_cols = max(1, (total_width - overlap + effective_step - 1) // effective_step)
        grid_rows = max(1, (total_height - overlap + effective_step - 1) // effective_step)

        tiles: List[Dict[str, Any]] = []

        for row in range(grid_rows):
            for col in range(grid_cols):
                x = col * effective_step
                y = row * effective_step
                actual_w = min(tile_size, total_width - x)
                actual_h = min(tile_size, total_height - y)

                region = slide.read_region((x, y), level, (actual_w, actual_h))
                if region.mode != "RGB":
                    region = region.convert("RGB")

                tiles.append({
                    "row": row,
                    "col": col,
                    "x": x,
                    "y": y,
                    "width": actual_w,
                    "height": actual_h,
                    "image_data": encode_image_base64(region),
                })

        return {
            "tiles": tiles,
            "grid_rows": grid_rows,
            "grid_cols": grid_cols,
            "total_width": total_width,
            "total_height": total_height,
        }


def main():
    parser = argparse.ArgumentParser(description="WSI 全玻片图像读取工具")
    parser.add_argument("--action", type=str, required=True, choices=["info", "tile", "batch_tiles"],
                        help="执行操作类型")
    parser.add_argument("--file_path", type=str, required=True, help="WSI 文件路径")
    parser.add_argument("--level", type=int, default=0, help="金字塔层级")
    parser.add_argument("--x", type=int, default=0, help="左上角 X 坐标")
    parser.add_argument("--y", type=int, default=0, help="左上角 Y 坐标")
    parser.add_argument("--width", type=int, default=512, help="切片宽度")
    parser.add_argument("--height", type=int, default=512, help="切片高度")
    parser.add_argument("--tile_size", type=int, default=512, help="批量切片尺寸")
    parser.add_argument("--overlap", type=int, default=32, help="重叠像素数")

    args = parser.parse_args()

    try:
        if args.action == "info":
            result = get_slide_info(args.file_path, args.level)
        elif args.action == "tile":
            result = read_tile(args.file_path, args.x, args.y, args.width, args.height, args.level)
        elif args.action == "batch_tiles":
            result = read_batch_tiles(args.file_path, args.tile_size, args.overlap, args.level)
        else:
            print(json.dumps({"error": f"未知操作: {args.action}"}), file=sys.stdout)
            sys.exit(1)

        print(json.dumps(result))
        sys.stdout.flush()
    except OpenSlideError as e:
        print(json.dumps({"error": f"OpenSlide 错误: {str(e)}"}), file=sys.stdout)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": str(sys.exc_info()[2])}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
