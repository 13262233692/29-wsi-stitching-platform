# WSI 全玻片病理图像拼接平台

面向数字医疗领域的巨幅医学图像处理平台，支持对数十 GB 级全玻片病理切片 (WSI) 执行全自动切片、超分辨率重构与大屏无缝拼接展示。

## 技术架构

```
┌──────────────────────────────────────────────────────────────┐
│  前端 Vue3 + OpenSeadragon                                     │
│  ┌──────────┐ ┌──────────────┐ ┌────────────────────────────┐ │
│  │ 任务控制台 │ │ WebSocket 状态 │ │ OpenSeadragon 大屏视口     │ │
│  └──────────┘ └──────────────┘ └────────────────────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST / WebSocket
┌───────────────────────▼──────────────────────────────────────┐
│  后端 NestJS (Node.js)                                         │
│  ┌─────────────┐  ┌────────────┐  ┌────────┐  ┌────────────┐ │
│  │ WSI 读取模块 │  │ Triton 客户端│  │ 拼接模块 │  │ OME-TIFF 流 │ │
│  └─────────────┘  └────────────┘  └────────┘  └────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │ python-shell 子进程
┌───────────────────────▼──────────────────────────────────────┐
│  Python 服务                                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │ OpenSlide 读取 │  │ Triton gRPC 客户端│  │ Gaussian Blending │ │
│  └──────────────┘  └───────────────┘  └────────────────────┘ │
└───────────────────────┬──────────────────────────────────────┘
                        │ gRPC
                ┌────────▼─────────┐
                │ Triton Inference │
                │  Server (SR 模型) │
                └──────────────────┘
```

## 项目结构

```
29-wsi-stitching-platform/
├── backend/                    # NestJS 后端服务
│   ├── src/
│   │   ├── modules/
│   │   │   ├── wsi-reader/     # WSI 滑窗读取 (OpenSlide 封装)
│   │   │   ├── triton-client/  # Triton 超分推理客户端
│   │   │   ├── stitching/      # 高斯混合拼接
│   │   │   ├── ome-tiff/       # OME-TIFF 流式组装
│   │   │   ├── streaming/      # HTTP 流式下载
│   │   │   ├── task-management/ # 任务管理与流程编排
│   │   │   └── websocket/      # Socket.IO 实时推送
│   │   └── ...
│   └── package.json
├── python-service/             # Python 算法服务
│   ├── src/
│   │   ├── wsi_reader.py       # OpenSlide 滑窗裁剪脚本
│   │   ├── triton_client/      # Triton gRPC 推理封装
│   │   └── blending/           # 高斯距离加权混合算法
│   └── requirements.txt
└── frontend/                   # Vue3 前端控制台
    ├── src/
    │   ├── components/
    │   │   ├── OpenSeadragonViewer.vue # 大屏视口组件
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
4. **高斯混合拼接**: 重叠区距离加权 (Gaussian Blending) 无缝拼接
5. **OME-TIFF 组装**: 流式组装为多分辨率金字塔 OME-TIFF
6. **WebSocket 推送**: 实时推送给前端 OpenSeadragon 大屏

## 快速启动

### 1. Python 服务依赖安装
```bash
cd python-service
pip install -r requirements.txt
```

### 2. 后端 NestJS 服务
```bash
cd backend
npm install
npm run start:dev
# 服务地址: http://localhost:3000
# API 文档: http://localhost:3000/api/docs
```

### 3. 前端 Vue3 控制台
```bash
cd frontend
npm install
npm run dev
# 控制台地址: http://localhost:5173
```

## 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| WSI_TILE_SIZE | 512 | 滑窗切片尺寸 (px) |
| WSI_OVERLAP | 32 | 切片重叠区域 (px) |
| TRITON_SCALE_FACTOR | 4 | 超分辨率放大倍数 |
| TRITON_MODEL_NAME | wsi_super_resolution | Triton 模型名 |

## 许可证

本项目仅供内部研发使用。
