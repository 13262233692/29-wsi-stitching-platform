# WSI 全玻片病理图像拼接平台

面向数字医疗领域的巨幅医学图像处理平台，支持对数十 GB 级全玻片病理切片 (WSI) 执行全自动切片、超分辨率重构与大屏无缝拼接展示。**已集成病理智能辅助诊断能力：基于形态学特征的细胞核实例分割、异常特征向量提取与 Milvus 向量持久化。**

## 技术架构

```
┌──────────────────────────────────────────────────────────────┐
│  前端 Vue3 + OpenSeadragon                                     │
│  ┌──────────┐ ┌──────────────┐ ┌────────────────────────────┐ │
│  │ 任务控制台 │ │ WebSocket 状态 │ │ 大屏视口 + 细胞热力图       │ │
│  └──────────┘ └──────────────┘ └────────────────────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST / WebSocket
┌───────────────────────▼──────────────────────────────────────┐
│  NestJS 主线程 (Event Loop) ◄── 仅处理 HTTP / WebSocket IO    │
│  ┌─────────────┐ ┌────────────┐ ┌────────┐ ┌───────────────┐ │
│  │ WSI 读取模块 │ │ Triton 客户端│ │ 任务编排 │ │ Milvus 客户端 │ │
│  └─────────────┘ └────────────┘ └────────┘ └───────────────┘ │
│         │                │                                     │
│  ┌──────▼────────────────▼──────────────────────────────────┐ │
│  │  Worker Threads 池 (物理隔离, 4 线程)                      │ │
│  │  ┌──────────────┬─────────────────┬─────────────────────┐ │ │
│  │  │ 高斯拼接算法   │ 细胞核实例分割   │ 128 维特征向量提取    │ │ │
│  │  │  (Float64)    │ + OpenCV 形态学  │ + 异常细胞检测        │ │ │
│  │  └──────────────┴─────────────────┴─────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │  (异常细胞特征向量)
                ┌───────▼───────┐
                │ Milvus 向量库 │
                │ (HNSW 索引)   │
                └───────────────┘
                        │ python-shell
┌───────────────────────▼──────────────────────────────────────┐
│  Python 服务 (OpenSlide / Triton gRPC / OpenCV)                │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────────────┐ │
│  │ OpenSlide 读取 │ │ Triton gRPC 客户端│ │ 细胞核分割 + 形态学  │ │
│  └──────────────┘ └───────────────┘ └──────────────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │ gRPC
                ┌────────▼─────────┐
                │ Triton Inference │
                │  Server (SR 模型) │
                └──────────────────┘
```

## 病理智能辅助诊断: 细胞核形态学分析管线

> 核心能力：对缝合完毕的高分辨率切片做**轻量级实例分割** + **OpenCV 纯数学形态学解算** + **Milvus 向量持久化**

```
缝合完成的 SR Tile (512→2048)
      │
      ▼
┌──────────────────────────────────────┐
│ Worker: Otsu 阈值 + 距离变换分水岭    │
│ 实例分割 (Instance Label Map)        │    ◀── 零依赖，纯 JS/TS 实现
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────┐
│ Worker: 形态学纯数学解算 (协方差 + 特征向量)            │
│  • 圆面积比  Circularity = 4π·Area / Perimeter²        │
│  • 长短轴比  AspectRatio = MajorAxis / MinorAxis       │
│    (像素协方差矩阵 → 特征值分解)                        │
│  • 边界粗糙度 Roughness = Perimeter / ConvexPerimeter   │
│  • 面凸性     Solidity = Area / ConvexArea              │
│  • 128 维 L2 归一化形态学特征向量                        │
└────────────┬───────────────────────────────────────────┘
             │  阈值判定 (≥2 项异常 → 标记)
             ▼
┌──────────────────────────┐
│ 异常细胞坐标 + 特征向量  │
└───────┬──────────────────┘
        │
        ├─────────────────────────────────────┐
        │ WebSocket 实时推送大屏              │ Milvus 持久化
        ▼                                      ▼
┌───────────────────────┐           ┌─────────────────────────────┐
│ 热力图 + 边界框        │           │ Collection:                 │
│ 叠加 OpenSeadragon 视口│           │   wsi_nucleus_features      │
└───────────────────────┘           │ 字段: id, vector(128),      │
                                    │  centroid_xy, bbox,         │
                                    │  circularity, aspect_ratio, │
                                    │  roughness, is_abnormal     │
                                    │ 索引: HNSW + COSINE         │
                                    └─────────────────────────────┘
```

### 形态学异常判定规则
| 指标 | 异常阈值 | 病理含义 |
|---|---|---|
| 圆面积比 Circularity | < 0.55 | 偏离圆形 → 多角形病变 |
| 长短轴比 AspectRatio | > 2.2 | 过度拉长 → 纺锤形异变 |
| 边界粗糙度 Roughness | > 1.35 | 边界毛糙 → 染色体聚集 |
| 面凸性 Solidity | < 0.55 | 轮廓凹陷 → 不规则分叶 |
| **2 项及以上同时触发** | — | **标记为恶性异常细胞** |

### 相关文件
- Python 算子: [nuclei_analyzer.py](file:///d:/SOLO-11/29-wsi-stitching-platform/python-service/src/cell_analysis/nuclei_analyzer.py)
- Worker 实现 (JS 零依赖): [stitching.worker.js](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/worker-pool/stitching.worker.js#L526-L705)
- Milvus 模块: [milvus.service.ts](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/milvus/milvus.service.ts)
- 细胞分析服务: [cell-analysis.service.ts](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/cell-analysis/cell-analysis.service.ts)
- 前端异常细胞面板: [AbnormalCellPanel.vue](file:///d:/SOLO-11/29-wsi-stitching-platform/frontend/src/components/AbnormalCellPanel.vue)
- 前端热力图叠加: [CellHeatmapOverlay.vue](file:///d:/SOLO-11/29-wsi-stitching-platform/frontend/src/components/CellHeatmapOverlay.vue)

## CPU 密集型计算与 Event Loop 隔离机制

> 场景: 当多名病理科医生并发加载特大型淋巴结切片时，数百毫秒级的浮点矩阵运算如果运行在 Node.js 主线程，
> 会直接死锁唯一的 Event Loop，导致 WebSocket 心跳与网络 IO 全部饿死，引发雪崩式断连。
>
> 本平台通过 `worker_threads` + 有界队列 + 超时终止 三重机制，将核心重计算 100% 剥离出主线程：

| 机制 | 实现位置 | 作用 |
|---|---|---|
| 线程池隔离 | [worker-pool.service.ts](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/worker-pool/worker-pool.service.ts) | `WorkerPoolService` 管理独立的 V8 Isolate，主线程仅负责 IO |
| 高斯混合 (Float64Array) | [stitching.worker.js](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/worker-pool/stitching.worker.js) | 纯 JS 实现 PNG 编解码 + 高斯权重 + 加权求和拼接，零依赖 |
| 细胞核分析 (JS 实现) | [stitching.worker.js](file:///d:/SOLO-11/29-wsi-stitching-platform/backend/src/modules/worker-pool/stitching.worker.js#L526-L705) | Otsu/分水岭/连通域/协方差椭圆/128维特征向量，全在 Worker 中 |
| 有界任务队列 | `WorkerPoolService.queue` | 超阈值直接拒绝，防止内存无限增长 |
| 超时强制终止 | `WORKER_TASK_TIMEOUT_MS` | 超时 Worker 被 `terminate()`，避免僵尸线程堆积 |
| 异常自动重启 | Worker `exit` 事件 | 进程崩溃后立即 respawn，保障高可用 |
| Event Loop 监控 | `startEventLoopMonitor` | 每 100ms 采样，>50ms 触发 WARN，60s 汇总 AVG/MAX |
| 健康监控端点 | `GET /api/worker-pool/stats` | 暴露 pool size / active / queue / memory / uptime |

### 可配置参数 (`backend/.env`)

```
WORKER_POOL_SIZE=4             # 线程数 (推荐 CPU-1, 最小 2, 最大 8)
WORKER_TASK_TIMEOUT_MS=180000  # 单任务超时 (ms)
WORKER_MAX_QUEUE=64            # 最大排队，防雪崩

# Milvus
MILVUS_HOST=localhost
MILVUS_PORT=19530
MILVUS_COLLECTION=wsi_nucleus_features
MILVUS_VECTOR_DIM=128

# 细胞核分析
NUCLEUS_ANALYSIS_ENABLED=true
NUCLEUS_SAMPLE_RATE=0.25       # 采样率，0.25 = 仅 25% 的 tile 进入分析
NUCLEUS_MAX_TILES=64           # 最大分析 tile 数，防止超大切片全扫描
NUCLEUS_ANALYSIS_CONCURRENCY=2
```

### 验证

```bash
node backend/src/modules/worker-pool/test.worker.standalone.js
# 典型输出:
#   Event Loop 最大阻塞: 8ms, 平均: 8.00ms   ✓ PASS (阻塞 < 30ms)
```

## 项目结构

```
29-wsi-stitching-platform/
├── backend/                    # NestJS 后端服务
│   ├── src/
│   │   ├── modules/
│   │   │   ├── wsi-reader/      # WSI 滑窗读取 (OpenSlide 封装)
│   │   │   ├── triton-client/   # Triton 超分推理客户端
│   │   │   ├── stitching/       # 高斯混合拼接 (调用 worker-pool)
│   │   │   ├── ome-tiff/        # OME-TIFF 流式组装
│   │   │   ├── streaming/       # HTTP 流式下载
│   │   │   ├── task-management/ # 任务管理与流程编排
│   │   │   ├── websocket/       # Socket.IO 实时推送
│   │   │   ├── cell-analysis/   # 细胞形态学分析服务
│   │   │   ├── milvus/          # Milvus 向量数据库客户端
│   │   │   └── worker-pool/     # ⭐ Worker Threads 线程池 + 核心算法
│   │   │       ├── worker-pool.service.ts
│   │   │       ├── worker-pool.types.ts
│   │   │       ├── stitching.worker.js        # 独立 V8 Isolate 内的 CPU 密集计算
│   │   │       └── test.worker.standalone.js  # Event Loop 阻塞验证脚本
│   │   └── ...
│   └── package.json
├── python-service/              # Python 算法服务
│   ├── src/
│   │   ├── wsi_reader.py        # OpenSlide 滑窗裁剪脚本
│   │   ├── triton_client/       # Triton gRPC 推理封装
│   │   ├── blending/            # 高斯距离加权混合算法
│   │   └── cell_analysis/       # ⭐ 细胞核实例分割 + 形态学特征提取
│   │       └── nuclei_analyzer.py
│   └── requirements.txt
└── frontend/                    # Vue3 前端控制台
    ├── src/
    │   ├── components/
    │   │   ├── OpenSeadragonViewer.vue # 大屏视口组件
    │   │   ├── AbnormalCellPanel.vue   # 异常细胞特征列表
    │   │   ├── CellHeatmapOverlay.vue  # 热力图 / 边界框叠加层
    │   │   ├── CreateTaskDialog.vue    # 新建任务对话框
    │   │   └── TaskItem.vue            # 任务卡片
    │   ├── views/               # 页面视图
    │   ├── store/               # Pinia 状态
    │   ├── utils/websocket.ts   # WebSocket 封装
    │   └── api/                 # REST API
    └── package.json
```

## 处理流程

1. **WSI 读取**: OpenSlide 读取金字塔 .svs 文件元信息
2. **滑窗裁剪**: 512×512 切片，32px 重叠区域
3. **超分重构**: 发送至 Triton Inference Server 执行 SR 推理 (默认 4x)
4. **高斯拼接**: 超分 tile 通过高斯距离加权混合算法在重叠区平滑拼接，输出大图
5. **细胞分析 (后台异步)**:
   - 采样 25% 的高分辨率 tile (可调)
   - Worker 线程池内运行实例分割 + 形态学计算
   - 异常细胞坐标 + 128 维特征向量写入 Milvus
   - WebSocket 实时推送热力图数据给大屏
6. **流式组装**: OME-TIFF 格式流式组装，长连接推送前端
7. **大屏展示**: OpenSeadragon 视口画布高倍率缩放查看，叠加细胞热力图

## 启动方式

### 1. Python 依赖
```bash
cd python-service
pip install -r requirements.txt
# 安装 OpenSlide 二进制: https://openslide.org/download/
```

### 2. Milvus 向量数据库 (可选)
```bash
# Docker 启动 Milvus
wget https://github.com/milvus-io/milvus/releases/download/v2.4.0/milvus-standalone-docker-compose.yml
docker compose up -d
```
*如果 Milvus 不可用，异常特征会自动 fallback 写入 `backend/data/milvus-fallback/*.jsonl`*

### 3. 后端服务
```bash
cd backend
npm install
npm run start:dev
# http://localhost:3000
# Swagger: http://localhost:3000/api
```

### 4. 前端控制台
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

## 核心 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/tasks` | 创建 WSI 处理任务 |
| GET | `/api/tasks` | 任务列表 |
| GET | `/api/tasks/:id` | 任务详情 |
| POST | `/api/tasks/:id/cancel` | 取消任务 |
| GET | `/api/cell-analysis/status` | 细胞分析 + Milvus 状态 |
| GET | `/api/cell-analysis/tasks/:id/abnormal` | 某任务的异常细胞列表 |
| POST | `/api/cell-analysis/tasks/:id/search-similar` | 向量相似度检索相似异常细胞 |
| POST | `/api/cell-analysis/analyze` | 调试: 对单张 tile 执行细胞分析 |
| GET | `/api/worker-pool/stats` | Worker 池状态 + Event Loop 监控 |
| GET | `/api/health` | 整体健康检查 |

## WebSocket 事件

| 事件 | 说明 |
|---|---|
| `task_status` | 任务状态更新 |
| `task_tile` | 单 tile 处理完成 (用于大屏实时拼接) |
| `task_progress` | 进度百分比 |
| `task_complete` | 任务完成，附带缩略图 |
| `task_error` | 任务错误 |
| `cell_analysis` | 单 tile 细胞分析结果 (热力图数据) |
| `nucleus_analysis_complete` | 细胞核分析阶段完成 |
