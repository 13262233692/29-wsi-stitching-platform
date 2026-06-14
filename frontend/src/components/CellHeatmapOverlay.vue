<template>
  <div class="heatmap-overlay" :class="{ show: show }">
    <svg
      class="heatmap-svg"
      :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="heatGradient">
          <stop offset="0%" stop-color="#ff4444" stop-opacity="0.9" />
          <stop offset="40%" stop-color="#ff9900" stop-opacity="0.5" />
          <stop offset="70%" stop-color="#ffcc00" stop-opacity="0.2" />
          <stop offset="100%" stop-color="#ffff00" stop-opacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- 热力点 -->
      <g v-if="mode === 'heatmap'">
        <circle
          v-for="(c, idx) in displayCells"
          :key="idx"
          :cx="c.centroid_x"
          :cy="c.centroid_y"
          :r="cellRadius(c)"
          fill="url(#heatGradient)"
          filter="url(#glow)"
          class="heat-dot"
          @click="handleCellClick(c)"
        />
      </g>

      <!-- 边界框 -->
      <g v-else-if="mode === 'bbox'">
        <rect
          v-for="(c, idx) in displayCells"
          :key="idx"
          :x="c.bbox_x"
          :y="c.bbox_y"
          :width="c.bbox_w"
          :height="c.bbox_h"
          fill="none"
          :stroke="cellColor(c)"
          stroke-width="2"
          class="bbox-rect"
          @click="handleCellClick(c)"
        />
        <circle
          v-for="(c, idx) in displayCells"
          :key="'c-' + idx"
          :cx="c.centroid_x"
          :cy="c.centroid_y"
          r="3"
          fill="#ff4444"
        />
      </g>

      <!-- 选中高亮 -->
      <g v-if="selectedCell">
        <circle
          :cx="selectedCell.centroid_x"
          :cy="selectedCell.centroid_y"
          r="40"
          fill="none"
          stroke="#00ffff"
          stroke-width="3"
          stroke-dasharray="8,4"
          class="pulse-ring"
        />
        <rect
          :x="selectedCell.bbox_x - 4"
          :y="selectedCell.bbox_y - 4"
          :width="selectedCell.bbox_w + 8"
          :height="selectedCell.bbox_h + 8"
          fill="none"
          stroke="#00ffff"
          stroke-width="3"
        />
      </g>
    </svg>

    <div class="mode-switch">
      <el-radio-group v-model="mode" size="small" @change="emitChange">
        <el-radio-button value="heatmap">热力图</el-radio-button>
        <el-radio-button value="bbox">边界框</el-radio-button>
        <el-radio-button value="off">关闭</el-radio-button>
      </el-radio-group>
      <el-tag size="small" effect="dark" type="danger">
        {{ displayCells.length }} 异常细胞
      </el-tag>
    </div>

    <div class="legend" v-if="mode !== 'off'">
      <div class="legend-item">
        <span class="dot" style="background:#ff4444"></span>
        <span>高异常分</span>
      </div>
      <div class="legend-item">
        <span class="dot" style="background:#ff9900"></span>
        <span>中异常分</span>
      </div>
      <div class="legend-item">
        <span class="dot" style="background:#ffcc00"></span>
        <span>低异常分</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NucleusAbnormalCell } from '@/types';

const props = defineProps<{
  imageWidth: number;
  imageHeight: number;
  cells: NucleusAbnormalCell[];
  selectedCell?: NucleusAbnormalCell | null;
  defaultMode?: 'heatmap' | 'bbox' | 'off';
}>();

const emit = defineEmits<{
  (e: 'cell-click', cell: NucleusAbnormalCell): void;
  (e: 'mode-change', mode: string): void;
}>();

const mode = ref(props.defaultMode || 'heatmap');
const show = computed(() => mode.value !== 'off' && props.cells.length > 0);
const displayCells = computed(() => props.cells.slice(0, 500));

function cellRadius(c: NucleusAbnormalCell) {
  const base = 15;
  const severity = (1 - c.circularity) + (c.roughness - 1) * 0.5 + Math.max(0, c.aspect_ratio - 1.5) * 0.3;
  return base + Math.min(30, severity * 25);
}

function cellColor(c: NucleusAbnormalCell) {
  if (c.abnormal_reasons?.includes('low_circularity') || c.circularity < 0.5) return '#ff4444';
  if (c.aspect_ratio > 2) return '#ff9900';
  if (c.roughness > 1.3) return '#ffcc00';
  return '#409eff';
}

function handleCellClick(c: NucleusAbnormalCell) {
  emit('cell-click', c);
}
function emitChange() {
  emit('mode-change', mode.value);
}

watch(
  () => props.defaultMode,
  (m) => { if (m) mode.value = m; },
);
</script>

<style scoped lang="scss">
.heatmap-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
  &.show { opacity: 1; pointer-events: auto; }
}
.heatmap-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.heat-dot, .bbox-rect {
  cursor: pointer;
  transition: opacity 0.2s;
  &:hover { opacity: 0.6; }
}
.pulse-ring {
  animation: pulse 1.5s ease-in-out infinite;
  transform-origin: center;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; stroke-dashoffset: 0; }
  50% { opacity: 1; stroke-dashoffset: 12; }
}
.mode-switch {
  position: absolute;
  top: 60px;
  left: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  background: rgba(10, 14, 26, 0.85);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(245, 108, 108, 0.3);
  z-index: 20;
}
.legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: rgba(10, 14, 26, 0.85);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #b0c4de;
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
  }
}
</style>
