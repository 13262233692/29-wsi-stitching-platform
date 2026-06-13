<template>
  <div class="task-mgmt-view">
    <div class="panel top-bar">
      <div class="filters">
        <el-select
          v-model="filterState"
          placeholder="全部状态"
          clearable
          style="width: 160px"
          @change="handleFilter"
        >
          <el-option label="等待中" value="pending" />
          <el-option label="读取图像" value="reading" />
          <el-option label="超分重构" value="super_resolving" />
          <el-option label="图像拼接" value="stitching" />
          <el-option label="保存输出" value="saving" />
          <el-option label="已完成" value="completed" />
          <el-option label="失败" value="failed" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
        <el-input
          v-model="searchKeyword"
          placeholder="搜索任务ID / 文件路径"
          clearable
          style="width: 280px"
          :prefix-icon="Search"
          @clear="handleFilter"
          @keyup.enter="handleFilter"
        />
      </div>
      <div class="actions">
        <el-button :icon="Refresh" @click="fetch">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="showCreate = true">
          新建任务
        </el-button>
      </div>
    </div>

    <div class="task-grid panel" v-loading="store.loadingTasks">
      <TaskItem
        v-for="task in filteredTasks"
        :key="task.taskId"
        :task="task"
      />
      <el-empty v-if="filteredTasks.length === 0" description="暂无任务" />
    </div>

    <div class="pagination-bar" v-if="store.totalTasks > pageSize">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="store.totalTasks"
        layout="prev, pager, next, total"
        background
        @current-change="fetch"
      />
    </div>

    <CreateTaskDialog v-model="showCreate" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { Search, Refresh, Plus } from '@element-plus/icons-vue';
import { useAppStore } from '@/store';
import { wsClient, type WsStatusPayload, type WsProgressPayload } from '@/utils/websocket';
import TaskItem from '@/components/TaskItem.vue';
import CreateTaskDialog from '@/components/CreateTaskDialog.vue';
import type { TaskState, TaskStatus } from '@/types';

const store = useAppStore();
const showCreate = ref(false);
const filterState = ref<TaskState | ''>('');
const searchKeyword = ref('');
const page = ref(1);
const pageSize = 10;

const filteredTasks = computed(() => {
  let list = store.tasks;
  if (filterState.value) {
    list = list.filter((t) => t.state === filterState.value);
  }
  if (searchKeyword.value.trim()) {
    const kw = searchKeyword.value.trim().toLowerCase();
    list = list.filter(
      (t) =>
        t.taskId.toLowerCase().includes(kw) ||
        t.filePath.toLowerCase().includes(kw),
    );
  }
  return list;
});

async function fetch() {
  await store.fetchTasks({
    state: filterState.value || undefined,
    offset: (page.value - 1) * pageSize,
    limit: 100,
  });
}

function handleFilter() {
  page.value = 1;
  fetch();
}

function onCreated(task: TaskStatus) {
  store.upsertTask(task);
  wsClient.subscribeTask(task.taskId);
}

function onTaskStatus(p: WsStatusPayload) {
  store.upsertTask(p as any);
}
function onTaskProgress(p: WsProgressPayload) {
  const current = store.tasks.find((t) => t.taskId === p.taskId);
  if (current) {
    store.upsertTask({
      taskId: p.taskId,
      progress: p.progress,
      message: p.message || current.message,
    });
  }
}

onMounted(() => {
  fetch();
  wsClient.connect();
  wsClient.on('task_status', onTaskStatus);
  wsClient.on('task_progress', onTaskProgress);
});
onBeforeUnmount(() => {
  wsClient.off('task_status', onTaskStatus);
  wsClient.off('task_progress', onTaskProgress);
});
</script>

<style scoped lang="scss">
.task-mgmt-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  .filters { display: flex; gap: 12px; }
  .actions { display: flex; gap: 8px; }
}
.task-grid {
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-height: calc(100vh - 280px);
  overflow: auto;
}
.pagination-bar {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
</style>
