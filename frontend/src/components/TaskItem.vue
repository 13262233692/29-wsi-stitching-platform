<template>
  <div class="task-item panel" @click="handleClick">
    <div class="task-header">
      <div class="task-id">
        <el-icon><Tickets /></el-icon>
        <span class="mono">{{ task.taskId }}</span>
      </div>
      <el-tag :color="bgColor" effect="dark" size="small" round>
        {{ stateLabel(task.state) }}
      </el-tag>
    </div>

    <div class="task-progress">
      <el-progress
        :percentage="Math.round(task.progress)"
        :color="stateColor(task.state)"
        :show-text="true"
        :stroke-width="6"
      />
    </div>

    <div class="task-meta">
      <div class="meta-row">
        <span class="label">文件</span>
        <span class="value file-path" :title="task.filePath">{{ shortPath }}</span>
      </div>
      <div class="meta-row" v-if="task.originalWidth">
        <span class="label">原始尺寸</span>
        <span class="value mono">{{ task.originalWidth }} × {{ task.originalHeight }}</span>
      </div>
      <div class="meta-row" v-if="task.outputWidth">
        <span class="label">输出尺寸</span>
        <span class="value mono">{{ task.outputWidth }} × {{ task.outputHeight }}</span>
      </div>
      <div class="meta-row" v-if="task.processedTiles">
        <span class="label">切片进度</span>
        <span class="value mono">{{ task.processedTiles }} / {{ task.totalTiles }}</span>
      </div>
      <div class="meta-row">
        <span class="label">创建时间</span>
        <span class="value">{{ formatTimestamp(task.createdAt) }}</span>
      </div>
      <div class="meta-row" v-if="task.startedAt">
        <span class="label">耗时</span>
        <span class="value mono">
          {{ formatDuration(task.startedAt, task.completedAt || Date.now()) }}
        </span>
      </div>
      <div class="meta-row" v-if="task.message">
        <span class="label">当前</span>
        <span class="value">{{ task.message }}</span>
      </div>
      <div class="meta-row error" v-if="task.errorMessage">
        <span class="label">错误</span>
        <span class="value">{{ task.errorMessage }}</span>
      </div>
    </div>

    <div class="task-actions" @click.stop>
      <el-button
        v-if="task.state === 'completed'"
        size="small"
        type="primary"
        @click="handleView"
      >
        <el-icon><View /></el-icon>查看
      </el-button>
      <el-button
        v-if="task.state === 'completed'"
        size="small"
        @click.stop="handleDownload"
      >
        <el-icon><Download /></el-icon>下载
      </el-button>
      <el-button
        v-if="canCancel"
        size="small"
        type="danger"
        plain
        @click.stop="handleCancel"
      >
        <el-icon><Close /></el-icon>取消
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { TaskStatus } from '@/types';
import { stateLabel, stateColor, formatTimestamp, formatDuration } from '@/utils/format';
import { cancelTask, downloadTaskResult } from '@/api';

const props = defineProps<{ task: TaskStatus }>();
defineEmits<{ (e: 'click', t: TaskStatus): void }>();
const router = useRouter();

const canCancel = computed(() =>
  ['pending', 'reading', 'super_resolving', 'stitching', 'saving'].includes(props.task.state),
);

const shortPath = computed(() => {
  const p = props.task.filePath;
  if (!p) return '-';
  return p.length > 40 ? '...' + p.slice(-38) : p;
});

const bgColor = computed(() => {
  const c = stateColor(props.task.state);
  return c;
});

function handleClick() {
  // parent handles
}

function handleView() {
  router.push(`/viewer/${props.task.taskId}`);
}

async function handleCancel() {
  try {
    await ElMessageBox.confirm('确定取消该任务？', '提示', { type: 'warning' });
    await cancelTask(props.task.taskId);
    ElMessage.success('已取消任务');
  } catch (_) { /* cancelled */ }
}

function handleDownload() {
  downloadTaskResult(props.task.taskId);
  ElMessage.info('开始下载输出文件');
}
</script>

<style scoped lang="scss">
.task-item {
  padding: 14px 16px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    border-color: rgba(64, 158, 255, 0.45);
    transform: translateY(-1px);
  }
}
.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  .task-id {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #409eff;
    font-weight: 600;
  }
}
.mono { font-family: 'Courier New', monospace; }
.task-progress {
  margin-bottom: 10px;
}
.task-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
  .meta-row {
    display: flex;
    font-size: 12px;
    line-height: 1.8;
    .label {
      color: #8b9cb5;
      width: 70px;
      flex-shrink: 0;
    }
    .value {
      color: #e0e6ed;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    &.error .value { color: #f56c6c; }
  }
  .file-path {
    font-family: 'Courier New', monospace;
    font-size: 11px;
  }
}
.task-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
