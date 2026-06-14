<template>
  <div class="viewer-view">
    <div class="viewer-controls panel">
      <div class="left">
        <el-select
          v-model="selectedTaskId"
          placeholder="选择任务以查看结果"
          filterable
          style="width: 380px"
          @change="handleSelectTask"
        >
          <el-option
            v-for="t in completedTasks"
            :key="t.taskId"
            :label="`${t.taskId} - ${t.filePath.split('/').pop() || t.filePath}`"
            :value="t.taskId"
          />
        </el-select>
        <el-tag v-if="task" effect="dark" size="small" :color="stateColor(task.state)">
          {{ stateLabel(task.state) }} {{ task.progress.toFixed(0) }}%
        </el-tag>
        <el-tag
          v-if="task?.nucleusAnalysis?.enabled"
          effect="plain"
          size="small"
          :type="nucleusStatusType"
        >
          <el-icon v-if="task.nucleusAnalysis.analyzedTiles < task.nucleusAnalysis.totalTiles" class="spin"><Loading /></el-icon>
          细胞核: {{ task.nucleusAnalysis.totalNuclei || 0 }} 个 /
          <span style="color:#f56c6c">异常 {{ task.nucleusAnalysis.abnormalCount || 0 }}</span>
        </el-tag>
        <el-tag
          v-if="milvusAvailable"
          type="success"
          effect="dark"
          size="small"
        >
          <el-icon><Connection /></el-icon>Milvus
        </el-tag>
      </div>
      <div class="right">
        <span v-if="task?.originalWidth" class="info-text">
          原始: {{ task.originalWidth }}×{{ task.originalHeight }}
          → 超分: {{ task.outputWidth }}×{{ task.outputHeight }}
        </span>
        <el-button
          v-if="task?.outputPath"
          type="primary"
          plain
          @click="download"
        >
          <el-icon><Download /></el-icon>下载 OME-TIFF
        </el-button>
      </div>
    </div>

    <div class="viewer-main">
      <div class="viewer-canvas panel">
        <OpenSeadragonViewer
          ref="osdRef"
          :task-id="selectedTaskId"
          :image-url="thumbnailUrl"
          :image-width="task?.outputWidth"
          :image-height="task?.outputHeight"
          :grid-rows="gridRows"
          :grid-cols="gridCols"
          :tile-size="srTileSize"
        />
        <CellHeatmapOverlay
          v-if="task?.outputWidth && task.outputHeight"
          :image-width="task.outputWidth"
          :image-height="task.outputHeight"
          :cells="abnormalCells"
          :selected-cell="selectedCell"
          @cell-click="handleCellClick"
        />
      </div>

      <div class="side-panel">
        <AbnormalCellPanel
          :task-id="selectedTaskId"
          :nucleus-analysis="task?.nucleusAnalysis"
          :milvus-available="milvusAvailable"
          @select="handleCellSelect"
          @locate="handleCellLocate"
          @search-similar="handleSearchSimilar"
        />

        <div v-if="task && task.state !== 'completed'" class="realtime-info panel">
          <div class="info-title glow-text">
            <el-icon class="pulse"><Bell /></el-icon>
            实时处理进度
          </div>
          <el-progress
            :percentage="Math.round(task.progress)"
            :color="stateColor(task.state)"
          />
          <div class="info-grid">
            <div class="info-item">
              <span class="k">阶段</span><span class="v">{{ stateLabel(task.state) }}</span>
            </div>
            <div class="info-item">
              <span class="k">消息</span><span class="v">{{ task.message }}</span>
            </div>
            <div class="info-item">
              <span class="k">已处理切片</span>
              <span class="v mono">{{ task.processedTiles || 0 }} / {{ task.totalTiles || '-' }}</span>
            </div>
            <div class="info-item">
              <span class="k">已耗时</span>
              <span class="v mono">{{ formatDuration(task.startedAt, task.completedAt || Date.now()) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Loading, Download, Connection } from '@element-plus/icons-vue';
import { useAppStore } from '@/store';
import { getTask, downloadTaskResult, getCellAnalysisStatus } from '@/api';
import {
  wsClient,
  type WsTilePayload,
  type WsStatusPayload,
  type WsCompletePayload,
  type WsCellAnalysisPayload,
  type WsNucleusAnalysisCompletePayload,
} from '@/utils/websocket';
import OpenSeadragonViewer from '@/components/OpenSeadragonViewer.vue';
import AbnormalCellPanel from '@/components/AbnormalCellPanel.vue';
import CellHeatmapOverlay from '@/components/CellHeatmapOverlay.vue';
import { stateLabel, stateColor, formatDuration } from '@/utils/format';
import type { TaskStatus, NucleusAbnormalCell } from '@/types';

const route = useRoute();
const store = useAppStore();
const osdRef = ref<InstanceType<typeof OpenSeadragonViewer> | null>(null);

const selectedTaskId = ref<string>('');
const task = ref<TaskStatus | null>(null);
const gridRows = ref<number>(0);
const gridCols = ref<number>(0);
const srTileSize = ref<number>(2048);
const milvusAvailable = ref(false);
const abnormalCells = ref<NucleusAbnormalCell[]>([]);
const selectedCell = ref<NucleusAbnormalCell | null>(null);

const completedTasks = computed(() =>
  store.tasks.filter((t) => t.state === 'completed' || t.state === 'super_resolving' || t.state === 'stitching'),
);

const thumbnailUrl = computed(() => {
  if (task.value?.thumbnail) {
    return `data:image/png;base64,${task.value.thumbnail}`;
  }
  return null;
});

const nucleusStatusType = computed(() => {
  const n = task.value?.nucleusAnalysis;
  if (!n) return 'info';
  if (n.analyzedTiles < n.totalTiles) return 'warning';
  if ((n.abnormalCount || 0) > 10) return 'danger';
  return 'success';
});

async function loadTask(taskId: string) {
  if (!taskId) return;
  abnormalCells.value = [];
  selectedCell.value = null;
  try {
    const t = await getTask(taskId);
    task.value = t;
    store.upsertTask(t);
    wsClient.subscribeTask(taskId);

    const tileSize = 512;
    const overlap = 32;
    const scale = 4;
    if (t.originalWidth) {
      const effectiveStep = tileSize - overlap;
      gridCols.value = Math.ceil((t.originalWidth - overlap) / effectiveStep);
      gridRows.value = Math.ceil((t.originalHeight! - overlap) / effectiveStep);
      srTileSize.value = tileSize * scale;
    }

    nextTick(() => {
      if (t.thumbnail && osdRef.value) {
        osdRef.value.setFullImageFromBase64(
          t.thumbnail,
          t.outputWidth || 4096,
          t.outputHeight || 4096,
        );
      }
    });
  } catch (err: any) {
    ElMessage.error(err.message || '加载任务失败');
  }
}

function handleSelectTask(taskId: string) {
  loadTask(taskId);
}

function download() {
  if (selectedTaskId.value) {
    downloadTaskResult(selectedTaskId.value);
  }
}

function handleCellClick(cell: NucleusAbnormalCell) {
  selectedCell.value = cell;
}
function handleCellSelect(cell: NucleusAbnormalCell) {
  selectedCell.value = cell;
}
function handleCellLocate(cell: NucleusAbnormalCell) {
  selectedCell.value = cell;
}
function handleSearchSimilar(_cell: NucleusAbnormalCell) {
  // AbnormalCellPanel 内部已处理
}

function onTaskStatus(p: WsStatusPayload) {
  if (p.taskId !== selectedTaskId.value) return;
  if (task.value) {
    task.value = { ...task.value, ...(p as any) } as TaskStatus;
    store.upsertTask(task.value);
  }
}
function onTaskTile(p: WsTilePayload) {
  if (p.taskId !== selectedTaskId.value) return;
  osdRef.value?.addTile(p);
}
function onTaskComplete(p: WsCompletePayload) {
  if (p.taskId !== selectedTaskId.value) return;
  if (task.value) {
    task.value.state = 'completed';
    task.value.progress = 100;
    task.value.completedAt = Date.now();
    task.value.outputPath = p.outputPath;
    if (p.thumbnail) {
      task.value.thumbnail = p.thumbnail;
      osdRef.value?.setFullImageFromBase64(
        p.thumbnail,
        task.value.outputWidth || 4096,
        task.value.outputHeight || 4096,
      );
    }
    store.upsertTask(task.value);
  }
  ElMessage.success('任务处理完成');
}

function onCellAnalysis(p: WsCellAnalysisPayload) {
  if (p.taskId !== selectedTaskId.value) return;
  const newCells = p.cells.map((c) => ({
    centroid_x: c.centroid_x,
    centroid_y: c.centroid_y,
    bbox_x: c.bbox_x,
    bbox_y: c.bbox_y,
    bbox_w: c.bbox_w,
    bbox_h: c.bbox_h,
    circularity: c.circularity,
    aspect_ratio: c.aspect_ratio,
    roughness: c.roughness,
    area: c.bbox_w * c.bbox_h,
    solidity: 1,
    mean_intensity: 0,
    is_abnormal: true,
    abnormal_reasons: c.reasons,
    feature_vector: [],
    tile_row: p.tile_index[0],
    tile_col: p.tile_index[1],
  }));
  abnormalCells.value = [...abnormalCells.value, ...newCells];

  if (task.value?.nucleusAnalysis) {
    const n = task.value.nucleusAnalysis;
    n.totalNuclei = (n.totalNuclei || 0) + p.total_count;
    n.abnormalCount = (n.abnormalCount || 0) + p.abnormal_count;
    store.upsertTask(task.value);
  }
}

function onNucleusComplete(_p: WsNucleusAnalysisCompletePayload) {
  ElMessage.success('细胞核分析完成');
}

watch(
  () => route.params.taskId,
  (id) => {
    if (id && typeof id === 'string') {
      selectedTaskId.value = id;
      loadTask(id);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  store.fetchTasks();
  wsClient.connect();
  wsClient.on('task_status', onTaskStatus);
  wsClient.on('task_tile', onTaskTile);
  wsClient.on('task_complete', onTaskComplete);
  wsClient.on('cell_analysis', onCellAnalysis);
  wsClient.on('nucleus_analysis_complete', onNucleusComplete);

  try {
    const st = await getCellAnalysisStatus();
    milvusAvailable.value = st.milvus.available;
  } catch {
    milvusAvailable.value = false;
  }
});
onBeforeUnmount(() => {
  wsClient.off('task_status', onTaskStatus);
  wsClient.off('task_tile', onTaskTile);
  wsClient.off('task_complete', onTaskComplete);
  wsClient.off('cell_analysis', onCellAnalysis);
  wsClient.off('nucleus_analysis_complete', onNucleusComplete);
});
</script>

<style scoped lang="scss">
.viewer-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
.viewer-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  .left, .right { display: flex; gap: 12px; align-items: center; }
  .info-text { color: #8b9cb5; font-size: 13px; }
}
.viewer-main {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 16px;
  min-height: 0;
}
.viewer-canvas {
  padding: 8px;
  position: relative;
  min-height: 0;
  overflow: hidden;
}
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: auto;
}
.realtime-info {
  padding: 14px 18px;
  .info-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 10px;
    .pulse {
      animation: pulse 1.5s ease-in-out infinite;
    }
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px 20px;
    margin-top: 12px;
    .info-item {
      display: flex;
      gap: 8px;
      font-size: 13px;
      .k { color: #8b9cb5; min-width: 70px; }
      .v { color: #e0e6ed; }
      .mono { font-family: 'Courier New', monospace; }
    }
  }
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.mono { font-family: 'Courier New', monospace; }
</style>
