<template>
  <div class="dashboard-view">
    <div class="stat-row">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="stat-card panel"
      >
        <div class="stat-icon" :style="{ background: stat.colorBg }">
          <el-icon :size="28" :color="stat.color"><component :is="stat.icon" /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value" :style="{ color: stat.color }">{{ stat.value }}</div>
          <div class="stat-label">{{ stat.label }}</div>
        </div>
      </div>
    </div>

    <div class="content-row">
      <div class="col-left">
        <div class="panel section-panel">
          <div class="section-header">
            <span class="title">运行中的任务</span>
            <el-button size="small" type="primary" @click="showCreate = true">
              <el-icon><Plus /></el-icon>新建任务
            </el-button>
          </div>
          <div class="task-list" v-loading="store.loadingTasks">
            <TaskItem
              v-for="task in store.runningTasks.slice(0, 5)"
              :key="task.taskId"
              :task="task"
            />
            <el-empty v-if="store.runningTasks.length === 0" description="暂无运行任务" />
          </div>
        </div>
      </div>

      <div class="col-right">
        <div class="panel section-panel">
          <div class="section-header">
            <span class="title">系统状态</span>
            <el-button size="small" text @click="store.fetchSystemStatus()">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>
          <div class="sys-status">
            <div
              v-for="item in systemStatusItems"
              :key="item.label"
              class="sys-item"
            >
              <div class="sys-dot" :class="{ live: item.online }"></div>
              <span class="sys-label">{{ item.label }}</span>
              <span class="sys-val" :class="{ ok: item.online, fail: !item.online }">
                {{ item.online ? '在线' : '离线' }}
              </span>
            </div>
          </div>
        </div>

        <div class="panel section-panel">
          <div class="section-header">
            <span class="title">最近完成任务</span>
          </div>
          <div class="task-list" v-loading="store.loadingTasks">
            <TaskItem
              v-for="task in recentCompleted"
              :key="task.taskId"
              :task="task"
            />
            <el-empty v-if="recentCompleted.length === 0" description="暂无完成任务" />
          </div>
        </div>
      </div>
    </div>

    <CreateTaskDialog v-model="showCreate" @created="onTaskCreated" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useAppStore } from '@/store';
import { wsClient, type WsStatusPayload, type WsProgressPayload } from '@/utils/websocket';
import TaskItem from '@/components/TaskItem.vue';
import CreateTaskDialog from '@/components/CreateTaskDialog.vue';
import type { TaskStatus } from '@/types';

const store = useAppStore();
const showCreate = ref(false);

const stats = computed(() => [
  { label: '总任务数', value: store.totalTasks, icon: 'Tickets', color: '#409eff', colorBg: 'rgba(64,158,255,0.15)' },
  { label: '运行中', value: store.runningTasks.length, icon: 'Loading', color: '#e6a23c', colorBg: 'rgba(230,162,60,0.15)' },
  { label: '已完成', value: store.tasks.filter((t) => t.state === 'completed').length, icon: 'CircleCheck', color: '#67c23a', colorBg: 'rgba(103,194,58,0.15)' },
  { label: '失败', value: store.tasks.filter((t) => t.state === 'failed').length, icon: 'CircleClose', color: '#f56c6c', colorBg: 'rgba(245,108,108,0.15)' },
]);

const systemStatusItems = computed(() => [
  { label: '后端 API 服务', online: store.backendHealthy },
  { label: 'Triton 推理服务', online: store.tritonStatus.serverLive },
  { label: '超分模型 (wsi_super_resolution)', online: store.tritonStatus.modelReady },
]);

const recentCompleted = computed(() =>
  store.tasks.filter((t) => t.state === 'completed').slice(0, 5),
);

function onTaskCreated(task: TaskStatus) {
  store.upsertTask(task);
  wsClient.subscribeTask(task.taskId);
}

function onTaskStatus(payload: WsStatusPayload) {
  store.upsertTask(payload as any);
}
function onTaskProgress(payload: WsProgressPayload) {
  const current = store.tasks.find((t) => t.taskId === payload.taskId);
  if (current) {
    store.upsertTask({
      taskId: payload.taskId,
      progress: payload.progress,
      message: payload.message || current.message,
    });
  }
}

onMounted(async () => {
  await store.fetchTasks();
  wsClient.connect();
  wsClient.on('task_status', onTaskStatus);
  wsClient.on('task_progress', onTaskProgress);
  store.runningTasks.forEach((t) => wsClient.subscribeTask(t.taskId));
});

onBeforeUnmount(() => {
  wsClient.off('task_status', onTaskStatus);
  wsClient.off('task_progress', onTaskProgress);
});
</script>

<style scoped lang="scss">
.dashboard-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  .stat-icon {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
  }
  .stat-label {
    color: #8b9cb5;
    font-size: 13px;
    margin-top: 4px;
  }
}
.content-row {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 16px;
}
.section-panel {
  padding: 16px;
  margin-bottom: 16px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  .title {
    font-size: 16px;
    font-weight: 600;
    color: #e0e6ed;
  }
}
.task-list {
  max-height: 420px;
  overflow: auto;
  padding-right: 4px;
}
.sys-status {
  display: flex;
  flex-direction: column;
  gap: 12px;
  .sys-item {
    display: flex;
    align-items: center;
    gap: 10px;
    .sys-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #f56c6c;
      box-shadow: 0 0 8px #f56c6c;
      &.live {
        background: #67c23a;
        box-shadow: 0 0 8px #67c23a;
      }
    }
    .sys-label { flex: 1; color: #b0c4de; font-size: 14px; }
    .sys-val.ok { color: #67c23a; }
    .sys-val.fail { color: #f56c6c; }
  }
}
</style>
