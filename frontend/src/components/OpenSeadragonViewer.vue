<template>
  <div ref="viewerRef" class="osd-viewer" :class="{ fullscreen: isFullscreen }">
    <div v-if="!loaded" class="osd-loading">
      <el-icon class="loading-icon" :size="48"><Loading /></el-icon>
      <p>正在初始化视口画布...</p>
    </div>
    <div v-if="showGrid" class="tile-grid-overlay" :style="gridStyle">
      <div
        v-for="(t, idx) in receivedTiles"
        :key="idx"
        class="tile-slot"
        :style="tileSlotStyle(t)"
      >
        <img :src="'data:image/png;base64,' + t.imageData" />
      </div>
    </div>
    <div class="osd-toolbar">
      <el-button-group>
        <el-button size="small" @click="zoomIn">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
        <el-button size="small" @click="zoomOut">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <el-button size="small" @click="home">
          <el-icon><FullScreen /></el-icon>
        </el-button>
      </el-button-group>
      <el-button size="small" @click="toggleFullscreen">
        <el-icon v-if="!isFullscreen"><FullScreen /></el-icon>
        <el-icon v-else><Aim /></el-icon>
      </el-button>
      <el-switch
        v-model="showGrid"
        active-text="叠加切片"
        inline-prompt
      />
    </div>
    <div class="osd-info panel">
      <div class="info-row">
        <span class="label">任务ID</span>
        <span class="value mono">{{ taskId || '-' }}</span>
      </div>
      <div class="info-row">
        <span class="label">尺寸</span>
        <span class="value mono">{{ infoText }}</span>
      </div>
      <div class="info-row">
        <span class="label">缩放</span>
        <span class="value mono">{{ zoomText }}</span>
      </div>
      <div class="info-row">
        <span class="label">已接收切片</span>
        <span class="value mono">{{ receivedTiles.length }} / {{ totalTiles }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  computed,
} from 'vue';
import OpenSeadragon from 'openseadragon';
import type { WsTilePayload } from '@/utils/websocket';

const props = defineProps<{
  taskId?: string | null;
  imageUrl?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  gridRows?: number;
  gridCols?: number;
  tileSize?: number;
}>(); 

const emit = defineEmits<{
  (e: 'ready', viewer: OpenSeadragon.Viewer): void;
}>();

const viewerRef = ref<HTMLDivElement | null>(null);
let viewer: OpenSeadragon.Viewer | null = null;
const loaded = ref(false);
const isFullscreen = ref(false);
const showGrid = ref(false);
const zoom = ref(1);
const receivedTiles = ref<WsTilePayload[]>([]);
const totalTiles = ref(0);

const infoText = computed(() => {
  if (props.imageWidth && props.imageHeight) {
    return `${props.imageWidth} × ${props.imageHeight}`;
  }
  return '-';
});

const zoomText = computed(() => `${(zoom.value * 100).toFixed(1)}%`);

const gridStyle = computed(() => {
  const rows = props.gridRows || 1;
  const cols = props.gridCols || 1;
  const ts = props.tileSize || 512;
  return {
    width: `${cols * ts}px`,
    height: `${rows * ts}px`,
  };
});

function tileSlotStyle(t: WsTilePayload) {
  const ts = props.tileSize || 512;
  return {
    left: `${t.col * ts}px`,
    top: `${t.row * ts}px`,
    width: `${ts}px`,
    height: `${ts}px`,
  };
}

function initViewer() {
  if (!viewerRef.value) return;
  viewer = OpenSeadragon({
    element: viewerRef.value,
    prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
    showNavigator: true,
    navigatorPosition: 'BOTTOM_RIGHT',
    showFullPageControl: false,
    showHomeControl: false,
    showZoomControl: false,
    constrainDuringPan: true,
    visibilityRatio: 0.5,
    minZoomLevel: 0.01,
    maxZoomLevel: 40,
    defaultZoomLevel: 1,
    animationTime: 0.3,
    blendTime: 0.1,
  });

  if (props.imageUrl) {
    viewer.open({
      type: 'image',
      url: props.imageUrl,
      width: props.imageWidth || 4096,
    });
  }

  viewer.addHandler('zoom', (evt) => {
    zoom.value = evt.zoom;
  });
  viewer.addHandler('open', () => {
    loaded.value = true;
    emit('ready', viewer!);
  });
  viewer.addHandler('open-failed', () => {
    loaded.value = true;
  });
}

function zoomIn() { viewer?.viewport.zoomBy(1.4); }
function zoomOut() { viewer?.viewport.zoomBy(1 / 1.4); }
function home() { viewer?.viewport.goHome(); }

function toggleFullscreen() {
  const el = viewerRef.value;
  if (!isFullscreen.value) {
    el?.requestFullscreen?.();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen?.();
    isFullscreen.value = true;
  }
}

function setFullImageFromBase64(b64: string, width: number, height: number) {
  if (!viewer) return;
  const url = `data:image/png;base64,${b64}`;
  viewer.open({
    type: 'image',
    url,
    width,
  });
}

function addTile(tile: WsTilePayload) {
  receivedTiles.value.push(tile);
}

function reset() {
  receivedTiles.value = [];
  totalTiles.value = 0;
}

watch(
  () => [props.imageUrl, props.imageWidth],
  () => {
    nextTick(() => {
      if (viewer && props.imageUrl) {
        viewer.open({
          type: 'image',
          url: props.imageUrl,
          width: props.imageWidth || 4096,
        });
      }
    });
  },
);

onMounted(() => {
  nextTick(initViewer);
});
onBeforeUnmount(() => {
  viewer?.destroy();
  viewer = null;
});

defineExpose({
  setFullImageFromBase64,
  addTile,
  reset,
  getViewer: () => viewer,
});
</script>

<style scoped lang="scss">
.osd-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 500px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(64, 158, 255, 0.2);

  :deep(.openseadragon-container) {
    width: 100% !important;
    height: 100% !important;
  }
}
.osd-viewer.fullscreen {
  border-radius: 0;
}
.osd-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8b9cb5;
  gap: 12px;
  .loading-icon {
    color: #409eff;
    animation: spin 1.2s linear infinite;
  }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.osd-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(10, 14, 26, 0.75);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(64, 158, 255, 0.2);
}
.osd-info {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 10;
  padding: 10px 14px;
  min-width: 220px;
  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 12px;
    .label { color: #8b9cb5; }
    .value { color: #e0e6ed; }
    .mono { font-family: 'Courier New', monospace; }
  }
}
.tile-grid-overlay {
  position: absolute;
  inset: 0;
  margin: auto;
  transform-origin: center center;
  pointer-events: none;
  .tile-slot {
    position: absolute;
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0.85;
      border: 1px solid rgba(64, 158, 255, 0.3);
    }
  }
}
</style>
