<template>
  <div class="system-view">
    <div class="panel section">
      <div class="section-title">系统配置</div>
      <el-form label-width="180px" class="config-form">
        <el-form-item label="WSI 切片尺寸">
          <el-input-number v-model="config.tileSize" :min="64" :max="2048" :step="64" />
          <span class="tip">px (默认 512)</span>
        </el-form-item>
        <el-form-item label="重叠区域像素">
          <el-input-number v-model="config.overlap" :min="0" :max="256" />
          <span class="tip">px (默认 32, 高斯混合区)</span>
        </el-form-item>
        <el-form-item label="默认金字塔层级">
          <el-input-number v-model="config.pyramidLevel" :min="0" :max="10" />
          <span class="tip">0 为最高分辨率</span>
        </el-form-item>
        <el-form-item label="超分放大倍数">
          <el-input-number v-model="config.scaleFactor" :min="1" :max="8" />
        </el-form-item>
        <el-form-item label="Triton 服务地址">
          <el-input v-model="config.tritonHost" style="width: 240px" />
          <el-input-number v-model="config.tritonPort" :min="1" :max="65535" style="margin-left:8px;width:140px" />
        </el-form-item>
        <el-form-item label="超分模型名称">
          <el-input v-model="config.modelName" style="width: 320px" />
        </el-form-item>
        <el-form-item label="模型版本">
          <el-input v-model="config.modelVersion" style="width: 120px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveConfig">保存配置</el-button>
          <el-button @click="resetConfig">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel section">
      <div class="section-title">系统服务状态</div>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="后端 API 服务">
          <span :class="{ ok: store.backendHealthy, fail: !store.backendHealthy }">
            {{ store.backendHealthy ? '● 正常运行' : '● 离线' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="Triton 推理服务">
          <span :class="{ ok: store.tritonStatus.serverLive, fail: !store.tritonStatus.serverLive }">
            {{ store.tritonStatus.serverLive ? '● 在线' : '● 离线' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="超分模型已加载">
          <span :class="{ ok: store.tritonStatus.modelReady, fail: !store.tritonStatus.modelReady }">
            {{ store.tritonStatus.modelReady ? '● 就绪' : '● 未就绪' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="WebSocket">
          <span :class="{ ok: wsConnected, fail: !wsConnected }">
            {{ wsConnected ? '● 已连接' : '● 未连接' }}
          </span>
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <div class="panel section">
      <div class="section-title">处理流程说明</div>
      <div class="pipeline">
        <div
          v-for="(s, idx) in pipelineSteps"
          :key="s.label"
          class="step"
        >
          <div class="step-num">{{ idx + 1 }}</div>
          <div class="step-body">
            <div class="step-label">{{ s.label }}</div>
            <div class="step-desc">{{ s.desc }}</div>
          </div>
          <div v-if="idx < pipelineSteps.length - 1" class="arrow">→</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useAppStore } from '@/store';
import { wsClient } from '@/utils/websocket';

const store = useAppStore();
const wsConnected = ref(false);

const defaultConfig = {
  tileSize: 512,
  overlap: 32,
  pyramidLevel: 0,
  scaleFactor: 4,
  tritonHost: 'localhost',
  tritonPort: 8001,
  modelName: 'wsi_super_resolution',
  modelVersion: '1',
};

const config = reactive({ ...defaultConfig });

const pipelineSteps = [
  { label: 'WSI 读取', desc: 'OpenSlide 读取金字塔 .svs 文件' },
  { label: '滑窗裁剪', desc: '512×512 切片, 32px 重叠区' },
  { label: '超分重构', desc: 'Triton 模型服务 SR 推理' },
  { label: '高斯混合', desc: '距离加权无缝拼接' },
  { label: 'OME-TIFF', desc: '流式组装并 WebSocket 推送' },
];

function saveConfig() {
  try {
    localStorage.setItem('wsi-config', JSON.stringify(config));
    ElMessage.success('配置已保存 (localStorage)');
  } catch (e) {
    ElMessage.error('保存失败');
  }
}
function resetConfig() {
  Object.assign(config, defaultConfig);
  ElMessage.info('已重置为默认值');
}

function updateWs() {
  wsConnected.value = wsClient.connected.value;
}

onMounted(() => {
  try {
    const saved = localStorage.getItem('wsi-config');
    if (saved) Object.assign(config, JSON.parse(saved));
  } catch (_) { /* ignore */ }
  wsClient.connect();
  updateWs();
  const t = window.setInterval(updateWs, 3000);
  (window as any).__wsiSysTimer = t;
});
onBeforeUnmount(() => {
  if ((window as any).__wsiSysTimer) clearInterval((window as any).__wsiSysTimer);
});
</script>

<style scoped lang="scss">
.system-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section {
  padding: 18px 20px;
  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #409eff;
    padding-left: 10px;
    border-left: 3px solid #409eff;
  }
}
.config-form {
  max-width: 800px;
}
.tip {
  color: #8b9cb5;
  font-size: 12px;
  margin-left: 10px;
}
.ok { color: #67c23a; font-weight: 600; }
.fail { color: #f56c6c; font-weight: 600; }
.pipeline {
  display: flex;
  align-items: stretch;
  gap: 8px;
  .step {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(64, 158, 255, 0.08);
    border: 1px solid rgba(64, 158, 255, 0.2);
    border-radius: 8px;
    padding: 12px 14px;
    position: relative;
    .step-num {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: #409eff;
      color: #fff;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .step-label { font-size: 14px; font-weight: 600; color: #e0e6ed; }
    .step-desc { font-size: 12px; color: #8b9cb5; margin-top: 2px; }
    .arrow {
      position: absolute;
      right: -14px;
      color: #409eff;
      font-size: 22px;
      font-weight: 700;
    }
  }
}
</style>
