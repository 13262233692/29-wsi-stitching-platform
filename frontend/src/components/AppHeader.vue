<template>
  <header class="app-header panel">
    <div class="header-left">
      <div class="logo">
        <el-icon :size="28" color="#409eff"><Picture /></el-icon>
        <span class="title glow-text">WSI 全玻片病理拼接平台</span>
      </div>
    </div>
    <div class="header-center">
      <div class="status-item" v-for="item in statusList" :key="item.label">
        <span class="status-dot" :class="{ live: item.online }"></span>
        <span class="status-label">{{ item.label }}:</span>
        <span class="status-value" :class="{ ok: item.online, fail: !item.online }">
          {{ item.online ? '正常' : '离线' }}
        </span>
      </div>
    </div>
    <div class="header-right">
      <span class="time">{{ currentTime }}</span>
      <el-button size="small" type="primary" plain @click="refresh">
        <el-icon><Refresh /></el-icon>刷新
      </el-button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAppStore } from '@/store';
import dayjs from 'dayjs';

const store = useAppStore();
const currentTime = ref('');
let timer: number | null = null;

const statusList = computed(() => [
  { label: '后端服务', online: store.backendHealthy },
  { label: 'Triton 推理', online: store.tritonStatus.serverLive },
  { label: '超分模型', online: store.tritonStatus.modelReady },
]);

function refresh() {
  store.fetchSystemStatus();
}

onMounted(() => {
  store.fetchSystemStatus();
  currentTime.value = dayjs().format('YYYY-MM-DD HH:mm:ss');
  timer = window.setInterval(() => {
    currentTime.value = dayjs().format('YYYY-MM-DD HH:mm:ss');
  }, 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped lang="scss">
.app-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  margin: 8px;
  border-radius: 8px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  .title {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 1px;
  }
}
.header-center {
  display: flex;
  gap: 32px;
}
.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f56c6c;
    box-shadow: 0 0 6px #f56c6c;
    &.live {
      background: #67c23a;
      box-shadow: 0 0 6px #67c23a;
    }
  }
  .status-label {
    color: #8b9cb5;
  }
  .status-value.ok { color: #67c23a; }
  .status-value.fail { color: #f56c6c; }
}
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  .time {
    color: #8b9cb5;
    font-family: 'Courier New', monospace;
    font-size: 14px;
  }
}
</style>
