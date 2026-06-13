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
    </div>

    <div v-if="task && task.state !== 'completed'" class="realtime-info panel">
      <div class="info-title glow-text">
        <el-icon class="pulse"><Bell /></el-icon>
        实时处理进度
      </div>
      <el-progress :percentage="Math.round(task.progress)" :color="stateColor(task.state)" />
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
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAppStore } from '@/store';
import { getTask, downloadTaskResult } from '@/api';
import { wsClient, type WsTilePayload, type WsStatusPayload, type WsCompletePayload } from '@/utils/websocket';
import OpenSeadragonViewer from '@/components/OpenSeadragonViewer.vue';
import { stateLabel, stateColor, formatDuration } from '@/utils/format';
import type { TaskStatus } from '@/types';

const route = useRoute();
const store = useAppStore();
const osdRef = ref<InstanceType<typeof OpenSeadragonViewer> | null>(null);

const selectedTaskId = ref<string>('');
const task = ref<TaskStatus | null>(null);
const gridRows = ref<number>(0);
const gridCols = ref<number>(0);
const srTileSize = ref<number>(2048);

const completedTasks = computed(() =>
  store.tasks.filter((t) => t.state === 'completed' || t.state === 'super_resolving' || t.state === 'stitching'),
);

const thumbnailUrl = computed(() => {
  if (task.value?.thumbnail) {
    return `data:image/png;base64,${task.value.thumbnail}`;
  }
  return null;
});

async function loadTask(taskId: string) {
  if (!taskId) return;
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

function onTaskStatus(p: WsStatusPayload) {
  if (p.taskId !== selectedTaskId.value) return;
  if (task.value) {
    task.value = { ...task.value, ...p } as TaskStatus;
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

onMounted(() => {
  store.fetchTasks();
  wsClient.connect();
  wsClient.on('task_status', onTaskStatus);
  wsClient.on('task_tile', onTaskTile);
  wsClient.on('task_complete', onTaskComplete);
});
onBeforeUnmount(() => {
  wsClient.off('task_status', onTaskStatus);
  wsClient.off('task_tile', onTaskTile);
  wsClient.off('task_complete', onTaskComplete);
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
.viewer-canvas {
  flex: 1;
  min-height: 0;
  padding: 8px;
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
    grid-template-columns: repeat(4, 1fr);
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
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.mono { font-family: 'Courier New', monospace; }
</style>
