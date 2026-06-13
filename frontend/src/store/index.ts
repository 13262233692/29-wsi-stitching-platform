import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { TaskStatus, TaskState, ServerStatus } from '@/types';
import { listTasks, getTritonStatus, getHealth } from '@/api';

export const useAppStore = defineStore('app', () => {
  const tasks = ref<TaskStatus[]>([]);
  const totalTasks = ref(0);
  const tritonStatus = ref<ServerStatus>({ serverLive: false, modelReady: false });
  const backendHealthy = ref(false);
  const loadingTasks = ref(false);
  const selectedTaskId = ref<string | null>(null);

  const selectedTask = computed(() =>
    tasks.value.find((t) => t.taskId === selectedTaskId.value) || null,
  );

  const runningTasks = computed(() =>
    tasks.value.filter(
      (t) =>
        t.state === 'reading' ||
        t.state === 'super_resolving' ||
        t.state === 'stitching' ||
        t.state === 'saving',
    ),
  );

  async function fetchTasks(params?: { state?: TaskState; offset?: number; limit?: number }) {
    loadingTasks.value = true;
    try {
      const res = await listTasks(params);
      tasks.value = res.items;
      totalTasks.value = res.total;
    } finally {
      loadingTasks.value = false;
    }
  }

  async function fetchSystemStatus() {
    try {
      await getHealth();
      backendHealthy.value = true;
    } catch {
      backendHealthy.value = false;
    }
    try {
      tritonStatus.value = await getTritonStatus();
    } catch {
      tritonStatus.value = { serverLive: false, modelReady: false };
    }
  }

  function upsertTask(task: Partial<TaskStatus> & { taskId: string }) {
    const idx = tasks.value.findIndex((t) => t.taskId === task.taskId);
    if (idx >= 0) {
      tasks.value[idx] = { ...tasks.value[idx], ...task };
    } else {
      tasks.value.unshift(task as TaskStatus);
    }
  }

  function selectTask(taskId: string | null) {
    selectedTaskId.value = taskId;
  }

  return {
    tasks,
    totalTasks,
    tritonStatus,
    backendHealthy,
    loadingTasks,
    selectedTaskId,
    selectedTask,
    runningTasks,
    fetchTasks,
    fetchSystemStatus,
    upsertTask,
    selectTask,
  };
});
