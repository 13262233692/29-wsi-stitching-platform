#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
细胞核形态学分析 Pipeline (供 NestJS 后端通过 python-shell 调用)

支持 action:
  analyze_tile        分析单张 tile: 分割 -> 特征提取 -> 异常判定 -> Milvus 入库
  query_task          查询指定 task_id 下所有异常细胞核
  search_similar      Milvus 按特征向量相似度检索
  delete_task         删除指定 task_id 下所有记录
  health              Milvus 健康检查
  demo_synthetic      生成合成细胞核测试数据 (调试)

输入:
  --action=...
  --input_json=...       (action=analyze_tile) 含以下字段的 JSON 文件路径:
                           {
                             "task_id": str,
                             "tile_row": int,
                             "tile_col": int,
                             "tile_global_offset": [x, y],
                             "wsi_width": int,
                             "wsi_height": int,
                             "image_b64": str,
                             "min_area": int,
                             "max_area": int,
                             "score_threshold": float,
                             "skip_milvus": bool,
                           }
  --task_id=...         (query_task / delete_task)
  --top_k=...
  --feature_json=...    (search_similar)

输出: stdout JSON
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import traceback
from typing import Dict, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from nucleus_analysis.nucleus_segmentation import segment_nuclei, _decode_b64_image
from nucleus_analysis.morphology_features import extract_all_nuclei_features
from nucleus_analysis.abnormality_classifier import batch_classify
from milvus.milvus_client import get_milvus_client


def _load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def action_analyze_tile(args) -> Dict:
    payload = _load_json(args.input_json)
    image_b64 = payload["image_b64"]
    task_id = payload["task_id"]
    tile_row = int(payload.get("tile_row", 0))
    tile_col = int(payload.get("tile_col", 0))
    tile_offset = payload.get("tile_global_offset", [0, 0])
    wsi_w = int(payload.get("wsi_width", 0))
    wsi_h = int(payload.get("wsi_height", 0))
    min_area = int(payload.get("min_area", 80))
    max_area = int(payload.get("max_area", 8000))
    threshold = float(payload.get("score_threshold", 0.5))
    skip_milvus = bool(payload.get("skip_milvus", False))

    # 1) 实例分割
    seg = segment_nuclei(image_b64, min_area=min_area, max_area=max_area)
    total_nuclei = seg["count"]
    if total_nuclei == 0:
        return {
            "task_id": task_id,
            "total_nuclei": 0,
            "abnormal_count": 0,
            "abnormal": [],
            "all": [],
        }

    # 2) 形态学特征
    img = _decode_b64_image(image_b64)
    all_feats = extract_all_nuclei_features(img, seg)

    # 3) 异常判定
    all_results, abnormal_only = batch_classify(all_feats)

    # 4) 阈值过滤
    if threshold > 0:
        abnormal_only = [a for a in abnormal_only if a["abnormality_score"] >= threshold]

    # 5) Milvus 入库
    saved = 0
    if not skip_milvus and abnormal_only:
        client = get_milvus_client()
        saved = client.insert_abnormal_nuclei(
            task_id=task_id,
            abnormal_list=abnormal_only,
            wsi_width=wsi_w,
            wsi_height=wsi_h,
            tile_row=tile_row,
            tile_col=tile_col,
            tile_global_offset=tuple(tile_offset),
        )

    # 6) 精简输出 (去掉大字段)
    def _compact(r: Dict) -> Dict:
        return {
            "inst_id": r["inst_id"],
            "centroid": r["centroid"],
            "bbox": r["bbox"],
            "area": r["area"],
            "circularity": r["circularity"],
            "aspect_ratio": r["aspect_ratio"],
            "solidity": r["solidity"],
            "boundary_roughness": r["boundary_roughness"],
            "ecd": r["ecd"],
            "rectangularity": r["rectangularity"],
            "fractal_dim": r["fractal_dim"],
            "intensity_std": r["intensity_std"],
            "abnormality_score": r["abnormality_score"],
            "abnormality_tags": r["abnormality_tags"],
            "sub_scores": r.get("sub_scores", {}),
            "feature_vector": r.get("feature_vector", []),
        }

    return {
        "task_id": task_id,
        "total_nuclei": total_nuclei,
        "abnormal_count": len(abnormal_only),
        "milvus_saved": saved,
        "abnormal": [_compact(a) for a in abnormal_only],
        "all_count": len(all_results),
        "all": [_compact(r) for r in all_results[:200]],  # 最多返回前 200 个
    }


def action_query_task(args) -> Dict:
    client = get_milvus_client()
    rows = client.query_by_task(args.task_id, top_k=int(getattr(args, "top_k", 5000) or 5000))
    return {"task_id": args.task_id, "count": len(rows), "items": rows}


def action_search_similar(args) -> Dict:
    client = get_milvus_client()
    fv_payload = _load_json(args.feature_json)
    feature_vector = fv_payload["feature_vector"]
    top_k = int(getattr(args, "top_k", 20) or 20)
    task_id = getattr(args, "task_id", None) or None
    rows = client.search_by_feature(
        feature_vector=feature_vector, top_k=top_k, task_id=task_id
    )
    return {"count": len(rows), "items": rows}


def action_delete_task(args) -> Dict:
    client = get_milvus_client()
    n = client.delete_by_task(args.task_id)
    return {"task_id": args.task_id, "deleted": n}


def action_health(_args) -> Dict:
    client = get_milvus_client()
    return client.health()


def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True)
    parser.add_argument("--input_json", default=None)
    parser.add_argument("--task_id", default=None)
    parser.add_argument("--feature_json", default=None)
    parser.add_argument("--top_k", default=None)
    args = parser.parse_args()

    try:
        if args.action == "analyze_tile":
            result = action_analyze_tile(args)
        elif args.action == "query_task":
            result = action_query_task(args)
        elif args.action == "search_similar":
            result = action_search_similar(args)
        elif args.action == "delete_task":
            result = action_delete_task(args)
        elif args.action == "health":
            result = action_health(_args=args)
        else:
            result = {"error": f"Unknown action: {args.action}"}
    except Exception as e:
        result = {
            "error": str(e),
            "traceback": traceback.format_exc(),
        }

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


if __name__ == "__main__":
    _main()
