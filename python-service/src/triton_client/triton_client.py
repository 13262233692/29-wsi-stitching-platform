#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Triton Inference Server 客户端封装
用于调用超分辨率模型对 WSI 切片进行超分重构
"""

import os
import sys
import json
import base64
import argparse
import numpy as np
from io import BytesIO
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass

try:
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "Pillow 未安装"}), file=sys.stdout)
    sys.exit(1)


@dataclass
class TritonConfig:
    """Triton 服务配置"""
    host: str = "localhost"
    port: int = 8001
    http_port: int = 8000
    model_name: str = "wsi_super_resolution"
    model_version: str = "1"
    scale_factor: int = 4
    request_timeout: float = 30.0


def decode_base64_image(b64_str: str) -> np.ndarray:
    """将 Base64 编码的图像解码为 numpy 数组 (H, W, 3) float32, 范围[0,1]"""
    img_data = base64.b64decode(b64_str)
    img = Image.open(BytesIO(img_data)).convert("RGB")
    arr = np.array(img, dtype=np.float32) / 255.0
    return arr


def encode_numpy_image(arr: np.ndarray) -> str:
    """将 numpy 数组 (H, W, 3) 编码为 Base64 PNG 字符串"""
    arr = np.clip(arr, 0, 1)
    arr_uint8 = (arr * 255).astype(np.uint8)
    img = Image.fromarray(arr_uint8, mode="RGB")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def preprocess_tile(
    image_arr: np.ndarray,
    input_size: Tuple[int, int] = (512, 512),
) -> np.ndarray:
    """
    图像预处理：
    - 调整大小到指定尺寸
    - 转换为 (N, C, H, W) 格式
    - 归一化到 [0, 1]
    """
    h, w = image_arr.shape[:2]
    target_h, target_w = input_size

    if h != target_h or w != target_w:
        img = Image.fromarray((image_arr * 255).astype(np.uint8), mode="RGB")
        img = img.resize((target_w, target_h), Image.BICUBIC)
        image_arr = np.array(img, dtype=np.float32) / 255.0

    batch = np.transpose(image_arr, (2, 0, 1))
    batch = np.expand_dims(batch, axis=0)
    return np.ascontiguousarray(batch, dtype=np.float32)


def postprocess_tile(
    output_arr: np.ndarray,
    original_size: Optional[Tuple[int, int]] = None,
    scale_factor: int = 4,
) -> np.ndarray:
    """
    图像后处理：
    - (N, C, H, W) -> (H, W, C)
    - 裁剪/调整到目标尺寸
    """
    arr = np.squeeze(output_arr, axis=0)
    arr = np.transpose(arr, (1, 2, 0))
    arr = np.clip(arr, 0, 1)

    if original_size:
        orig_h, orig_w = original_size
        target_h, target_w = orig_h * scale_factor, orig_w * scale_factor
        cur_h, cur_w = arr.shape[:2]
        if cur_h != target_h or cur_w != target_w:
            img = Image.fromarray((arr * 255).astype(np.uint8), mode="RGB")
            img = img.resize((target_w, target_h), Image.BICUBIC)
            arr = np.array(img, dtype=np.float32) / 255.0

    return arr


def mock_super_resolution(
    input_arr: np.ndarray,
    scale_factor: int = 4,
) -> np.ndarray:
    """
    模拟超分推理 (当 Triton 不可用时的 fallback)
    使用双三次插值放大
    """
    n, c, h, w = input_arr.shape
    new_h, new_w = h * scale_factor, w * scale_factor

    output = np.zeros((n, c, new_h, new_w), dtype=np.float32)
    for i in range(n):
        for j in range(c):
            img = Image.fromarray((input_arr[i, j] * 255).astype(np.uint8))
            img_resized = img.resize((new_w, new_h), Image.BICUBIC)
            output[i, j] = np.array(img_resized, dtype=np.float32) / 255.0

    return output


def try_triton_infer(
    input_arr: np.ndarray,
    config: TritonConfig,
) -> Optional[np.ndarray]:
    """尝试通过 Triton 客户端进行推理，失败返回 None"""
    try:
        import tritonclient.grpc as grpc_client
        from tritonclient.utils import InferenceServerException

        triton_client = grpc_client.InferenceServerClient(
            url=f"{config.host}:{config.port}",
            verbose=False,
        )

        if not triton_client.is_server_live():
            return None

        model_metadata = triton_client.get_model_metadata(
            model_name=config.model_name,
            model_version=config.model_version,
        )
        inputs_name = model_metadata.inputs[0].name
        outputs_name = model_metadata.outputs[0].name

        inputs = [grpc_client.InferInput(inputs_name, input_arr.shape, "FP32")]
        inputs[0].set_data_from_numpy(input_arr)

        outputs = [grpc_client.InferRequestedOutput(outputs_name)]

        result = triton_client.infer(
            model_name=config.model_name,
            inputs=inputs,
            outputs=outputs,
            model_version=config.model_version,
            client_timeout=int(config.request_timeout * 1000),
        )

        output_data = result.as_numpy(outputs_name)
        return output_data
    except ImportError:
        return None
    except Exception:
        return None


def super_resolve_tile(
    image_b64: str,
    config: TritonConfig,
) -> Dict[str, Any]:
    """
    对单张切片执行超分重构
    返回: { "image_data": base64_str, "width": int, "height": int }
    """
    input_arr = decode_base64_image(image_b64)
    orig_h, orig_w = input_arr.shape[:2]

    preprocessed = preprocess_tile(input_arr)
    result = try_triton_infer(preprocessed, config)

    if result is None:
        result = mock_super_resolution(preprocessed, config.scale_factor)

    output_arr = postprocess_tile(result, (orig_h, orig_w), config.scale_factor)
    out_h, out_w = output_arr.shape[:2]

    return {
        "image_data": encode_numpy_image(output_arr),
        "width": out_w,
        "height": out_h,
        "scale_factor": config.scale_factor,
        "used_triton": result is not None and "triton" in str(type(result).__module__).lower(),
    }


def super_resolve_batch(
    tiles: List[Dict[str, Any]],
    config: TritonConfig,
) -> Dict[str, Any]:
    """批量对切片执行超分重构"""
    results = []
    for idx, tile in enumerate(tiles):
        sr_result = super_resolve_tile(tile["image_data"], config)
        results.append({
            "row": tile.get("row"),
            "col": tile.get("col"),
            "x": tile.get("x"),
            "y": tile.get("y"),
            "width": sr_result["width"],
            "height": sr_result["height"],
            "image_data": sr_result["image_data"],
        })
        if idx % 10 == 0:
            print(json.dumps({"progress": (idx + 1) / len(tiles) * 100}), file=sys.stderr)
            sys.stderr.flush()

    return {"tiles": results}


def main():
    parser = argparse.ArgumentParser(description="Triton 超分推理客户端")
    parser.add_argument("--action", type=str, required=True,
                        choices=["single", "batch", "status"])
    parser.add_argument("--image_data", type=str, default=None,
                        help="Base64 编码的输入图像 (single 模式)")
    parser.add_argument("--tiles_json", type=str, default=None,
                        help="切片列表 JSON 文件路径 (batch 模式)")
    parser.add_argument("--host", type=str, default=os.environ.get("TRITON_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRITON_PORT", "8001")))
    parser.add_argument("--model_name", type=str, default=os.environ.get("TRITON_MODEL_NAME", "wsi_super_resolution"))
    parser.add_argument("--model_version", type=str, default=os.environ.get("TRITON_MODEL_VERSION", "1"))
    parser.add_argument("--scale_factor", type=int, default=int(os.environ.get("TRITON_SCALE_FACTOR", "4")))

    args = parser.parse_args()
    config = TritonConfig(
        host=args.host,
        port=args.port,
        model_name=args.model_name,
        model_version=args.model_version,
        scale_factor=args.scale_factor,
    )

    try:
        if args.action == "status":
            try:
                import tritonclient.grpc as grpc_client
                client = grpc_client.InferenceServerClient(url=f"{config.host}:{config.port}")
                live = client.is_server_live()
                ready = client.is_model_ready(config.model_name, config.model_version)
                print(json.dumps({"server_live": live, "model_ready": ready}))
            except ImportError:
                print(json.dumps({"server_live": False, "model_ready": False, "note": "tritonclient 未安装，使用 mock 模式"}))
        elif args.action == "single":
            if not args.image_data:
                raise ValueError("single 模式需提供 --image_data")
            result = super_resolve_tile(args.image_data, config)
            print(json.dumps(result))
        elif args.action == "batch":
            if not args.tiles_json:
                raise ValueError("batch 模式需提供 --tiles_json")
            with open(args.tiles_json, "r", encoding="utf-8") as f:
                tiles = json.load(f)
            result = super_resolve_batch(tiles, config)
            print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
