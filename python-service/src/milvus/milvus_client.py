#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Milvus 向量数据库封装

集合 (Collection) Schema:
  Collection name: wsi_abnormal_nuclei
  Fields:
    - id              (VARCHAR, 64)  PK:  "{task_id}_{tile_row}_{tile_col}_{inst_id}"
    - task_id         (VARCHAR, 64)  所属 WSI 任务 ID
    - wsi_x           (INT32)        物理空间 x 坐标 (全局像素, 左上)
    - wsi_y           (INT32)        物理空间 y 坐标 (全局像素, 左上)
    - wsi_width       (INT32)        全局图像宽 (参考)
    - wsi_height      (INT32)        全局图像高 (参考)
    - tile_row        (INT16)        tile 行
    - tile_col        (INT16)        tile 列
    - inst_id         (INT32)        tile 内实例 ID
    - circularity     (FLOAT)        圆面积比
    - aspect_ratio    (FLOAT)        长短轴比
    - boundary_roughness (FLOAT)     边界粗糙度
    - intensity_std   (FLOAT)        核内光密度方差
    - abnormality_score (FLOAT)      综合异常评分
    - tags            (VARCHAR, 256) 逗号分隔的异常标签
    - created_at      (INT64)        创建时间戳 (ms)
    - feature_vector  (FLOAT_VECTOR, 12)  Milvus 向量检索

支持:
  - ensure_collection()  创建/加载集合
  - insert()             批量插入异常细胞
  - search_by_feature()  按 12-D 向量做 Top-K 相似度检索
  - query_by_task()      按任务 ID 查出所有异常细胞核 (用于前端可视化)
  - delete_by_task()     删除某任务的所有记录
"""
from __future__ import annotations

from typing import Dict, List, Optional, Any
import os
import time
import json

try:
    from pymilvus import (
        connections,
        utility,
        Collection,
        CollectionSchema,
        FieldSchema,
        DataType,
        MilvusException,
    )
    HAS_MILVUS = True
except ImportError:
    HAS_MILVUS = False


VECTOR_DIM = 12
COLLECTION_NAME = "wsi_abnormal_nuclei"


class MilvusClient:
    """对 Milvus 的轻量封装 (若未安装 pymilvus 则退化为本地 JSON 存储)"""

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        alias: str = "default",
        fallback_json_dir: str = "./data/milvus_fallback",
    ) -> None:
        self.host = host or os.environ.get("MILVUS_HOST", "localhost")
        self.port = int(port or os.environ.get("MILVUS_PORT", "19530"))
        self.alias = alias
        self.collection: Optional[Any] = None
        self.fallback_json_dir = fallback_json_dir
        self._connected = False
        self._use_fallback = False

    # ------------------------------------------------------------------
    # 连接与集合
    # ------------------------------------------------------------------
    def connect(self) -> bool:
        if not HAS_MILVUS:
            self._use_fallback = True
            os.makedirs(self.fallback_json_dir, exist_ok=True)
            return True
        try:
            connections.connect(alias=self.alias, host=self.host, port=self.port)
            self._connected = True
            return True
        except (MilvusException, Exception) as e:
            print(f"[Milvus] 连接失败 ({self.host}:{self.port}), 降级为本地 JSON: {e}")
            self._use_fallback = True
            os.makedirs(self.fallback_json_dir, exist_ok=True)
            return True

    def ensure_collection(self) -> None:
        if self._use_fallback:
            return
        if utility.has_collection(COLLECTION_NAME, using=self.alias):
            self.collection = Collection(COLLECTION_NAME, using=self.alias)
            self.collection.load()
            return

        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
            FieldSchema(name="task_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="wsi_x", dtype=DataType.INT32),
            FieldSchema(name="wsi_y", dtype=DataType.INT32),
            FieldSchema(name="wsi_width", dtype=DataType.INT32),
            FieldSchema(name="wsi_height", dtype=DataType.INT32),
            FieldSchema(name="tile_row", dtype=DataType.INT16),
            FieldSchema(name="tile_col", dtype=DataType.INT16),
            FieldSchema(name="inst_id", dtype=DataType.INT32),
            FieldSchema(name="circularity", dtype=DataType.FLOAT),
            FieldSchema(name="aspect_ratio", dtype=DataType.FLOAT),
            FieldSchema(name="boundary_roughness", dtype=DataType.FLOAT),
            FieldSchema(name="intensity_std", dtype=DataType.FLOAT),
            FieldSchema(name="abnormality_score", dtype=DataType.FLOAT),
            FieldSchema(name="tags", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="created_at", dtype=DataType.INT64),
            FieldSchema(name="feature_vector", dtype=DataType.FLOAT_VECTOR, dim=VECTOR_DIM),
        ]
        schema = CollectionSchema(fields, description="WSI abnormal nuclei morphology features")
        self.collection = Collection(COLLECTION_NAME, schema, using=self.alias)

        # 建立 IVF_FLAT 向量索引
        index_params = {
            "metric_type": "L2",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 128},
        }
        self.collection.create_index(field_name="feature_vector", index_params=index_params)
        # 建立标量索引
        for col in ("task_id", "abnormality_score"):
            try:
                self.collection.create_index(field_name=col, index_name=f"idx_{col}")
            except Exception:
                pass
        self.collection.load()

    # ------------------------------------------------------------------
    # 写入
    # ------------------------------------------------------------------
    def insert_abnormal_nuclei(
        self,
        task_id: str,
        abnormal_list: List[Dict],
        wsi_width: int,
        wsi_height: int,
        tile_row: int = 0,
        tile_col: int = 0,
        tile_global_offset: tuple = (0, 0),
    ) -> int:
        """
        批量插入异常细胞核
        abnormal_list: 每个元素至少要有 centroid, bbox, feature_vector, 以及各形态学字段
        """
        if not abnormal_list:
            return 0
        if self.collection is None and not self._use_fallback:
            self.ensure_collection()

        rows: List[Dict] = []
        for a in abnormal_list:
            ox, oy = tile_global_offset
            cx, cy = a["centroid"]
            pk = f"{task_id}_{tile_row}_{tile_col}_{a['inst_id']}"
            rows.append({
                "id": pk,
                "task_id": task_id,
                "wsi_x": int(ox + cx),
                "wsi_y": int(oy + cy),
                "wsi_width": int(wsi_width),
                "wsi_height": int(wsi_height),
                "tile_row": int(tile_row),
                "tile_col": int(tile_col),
                "inst_id": int(a["inst_id"]),
                "circularity": float(a.get("circularity", 0.0)),
                "aspect_ratio": float(a.get("aspect_ratio", 0.0)),
                "boundary_roughness": float(a.get("boundary_roughness", 0.0)),
                "intensity_std": float(a.get("intensity_std", 0.0)),
                "abnormality_score": float(a.get("abnormality_score", 0.0)),
                "tags": ",".join(a.get("abnormality_tags", [])),
                "created_at": int(time.time() * 1000),
                "feature_vector": [float(v) for v in a["feature_vector"]],
            })

        if self._use_fallback:
            return self._fallback_insert(task_id, rows)
        try:
            data = [
                [r["id"] for r in rows],
                [r["task_id"] for r in rows],
                [r["wsi_x"] for r in rows],
                [r["wsi_y"] for r in rows],
                [r["wsi_width"] for r in rows],
                [r["wsi_height"] for r in rows],
                [r["tile_row"] for r in rows],
                [r["tile_col"] for r in rows],
                [r["inst_id"] for r in rows],
                [r["circularity"] for r in rows],
                [r["aspect_ratio"] for r in rows],
                [r["boundary_roughness"] for r in rows],
                [r["intensity_std"] for r in rows],
                [r["abnormality_score"] for r in rows],
                [r["tags"] for r in rows],
                [r["created_at"] for r in rows],
                [r["feature_vector"] for r in rows],
            ]
            mr = self.collection.insert(data)
            self.collection.flush()
            return int(mr.insert_count) if mr else len(rows)
        except Exception as e:
            print(f"[Milvus] 写入失败, 降级本地: {e}")
            self._use_fallback = True
            return self._fallback_insert(task_id, rows)

    def _fallback_insert(self, task_id: str, rows: List[Dict]) -> int:
        fp = os.path.join(self.fallback_json_dir, f"{task_id}.jsonl")
        with open(fp, "a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return len(rows)

    # ------------------------------------------------------------------
    # 读取
    # ------------------------------------------------------------------
    def query_by_task(self, task_id: str, top_k: int = 5000) -> List[Dict]:
        if self.collection is None and not self._use_fallback:
            self.ensure_collection()
        if self._use_fallback:
            return self._fallback_query(task_id, top_k=top_k)
        try:
            expr = f'task_id == "{task_id}"'
            self.collection.load()
            results = self.collection.query(
                expr,
                output_fields=[
                    "id", "task_id", "wsi_x", "wsi_y", "wsi_width", "wsi_height",
                    "tile_row", "tile_col", "inst_id",
                    "circularity", "aspect_ratio", "boundary_roughness",
                    "intensity_std", "abnormality_score", "tags", "created_at",
                ],
                limit=top_k,
            )
            return list(results)
        except Exception as e:
            print(f"[Milvus] query 失败: {e}")
            return []

    def _fallback_query(self, task_id: str, top_k: int) -> List[Dict]:
        fp = os.path.join(self.fallback_json_dir, f"{task_id}.jsonl")
        if not os.path.exists(fp):
            return []
        out = []
        with open(fp, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                out.append(json.loads(line))
                if len(out) >= top_k:
                    break
        return out

    def search_by_feature(
        self,
        feature_vector: List[float],
        top_k: int = 20,
        task_id: Optional[str] = None,
        min_score: float = 0.0,
    ) -> List[Dict]:
        if not self._use_fallback and self.collection is None:
            self.ensure_collection()
        if self._use_fallback:
            return self._fallback_bruteforce_search(feature_vector, top_k, task_id, min_score)

        search_params = {"metric_type": "L2", "params": {"nprobe": 16}}
        expr = f'task_id == "{task_id}"' if task_id else None
        try:
            res = self.collection.search(
                [feature_vector],
                anns_field="feature_vector",
                param=search_params,
                limit=top_k,
                expr=expr,
                output_fields=[
                    "id", "task_id", "wsi_x", "wsi_y", "circularity",
                    "aspect_ratio", "boundary_roughness", "intensity_std",
                    "abnormality_score", "tags",
                ],
            )
            out = []
            for hits in res:
                for h in hits:
                    d = dict(h.entity.fields or {})
                    d["_distance"] = float(h.distance)
                    d["_score"] = float(1.0 / (1.0 + h.distance))
                    if d["_score"] >= min_score:
                        out.append(d)
            return out
        except Exception as e:
            print(f"[Milvus] search 失败: {e}")
            return []

    def _fallback_bruteforce_search(
        self,
        feature_vector: List[float],
        top_k: int,
        task_id: Optional[str],
        min_score: float,
    ) -> List[Dict]:
        # 线性扫描所有 JSONL 文件
        import glob
        files = (
            [os.path.join(self.fallback_json_dir, f"{task_id}.jsonl")]
            if task_id
            else glob.glob(os.path.join(self.fallback_json_dir, "*.jsonl"))
        )
        fv = np.array(feature_vector, dtype=np.float32)
        candidates = []
        for fp in files:
            if not os.path.exists(fp):
                continue
            with open(fp, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    r = json.loads(line)
                    v = np.array(r["feature_vector"], dtype=np.float32)
                    dist = float(np.linalg.norm(fv - v))
                    score = 1.0 / (1.0 + dist)
                    if score >= min_score:
                        r["_distance"] = dist
                        r["_score"] = score
                        candidates.append(r)
        candidates.sort(key=lambda r: r["_score"], reverse=True)
        return candidates[:top_k]

    def delete_by_task(self, task_id: str) -> int:
        if self.collection is None and not self._use_fallback:
            self.ensure_collection()
        if self._use_fallback:
            fp = os.path.join(self.fallback_json_dir, f"{task_id}.jsonl")
            if os.path.exists(fp):
                os.remove(fp)
            return 0
        try:
            expr = f'task_id == "{task_id}"'
            self.collection.delete(expr)
            self.collection.flush()
            return 1
        except Exception as e:
            print(f"[Milvus] delete 失败: {e}")
            return 0

    def health(self) -> Dict:
        return {
            "available": HAS_MILVUS,
            "connected": self._connected,
            "use_fallback": self._use_fallback,
            "collection": COLLECTION_NAME,
            "vector_dim": VECTOR_DIM,
            "host": self.host,
            "port": self.port,
        }


# 单例
_CLIENT: Optional[MilvusClient] = None


def get_milvus_client() -> MilvusClient:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = MilvusClient()
        _CLIENT.connect()
        _CLIENT.ensure_collection()
    return _CLIENT


import numpy as np  # noqa: E402 (延迟导入避免循环)
