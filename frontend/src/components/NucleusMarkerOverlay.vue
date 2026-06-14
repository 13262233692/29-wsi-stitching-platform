<template>
  <div
    v-if="records.length > 0"
    class="nucleus-overlay"
    :style="overlayStyle"
  >
    <div
      v-for="r in records"
      :key="r.id"
      class="nucleus-marker"
      :class="markerClass(r)"
      :style="markerStyle(r)"
      :title="tooltipText(r)"
      @click="handleClick(r)"
    >
      <div class="ring"></div>
      <div class="score">{{ (r.abnormality_score * 100).toFixed(0) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MilvusRecord, NucleusFeature } from '@/types';

const props = defineProps<{
  records: Array<{
    id?: string;
    wsi_x: number;
    wsi_y: number;
    circularity: number;
    aspect_ratio: number;
    boundary_roughness: number;
    intensity_std: number;
    abnormality_score: number;
    tags?: string;
  }>;
  imageWidth: number;
  imageHeight: number;
  viewerWidth: number;
  viewerHeight: number;
  zoom: number;
  markerSize?: number;
}>(); 

const emit = defineEmits<{
  (e: 'select', r: any): void;
}>();

const scaleX = computed(() => props.viewerWidth / props.imageWidth);
const scaleY = computed(() => props.viewerHeight / props.imageHeight);

const overlayStyle = computed(() => ({
  width: `${props.viewerWidth}px`,
  height: `${props.viewerHeight}px`,
}));

function markerStyle(r: any) {
  const size = props.markerSize ?? 28;
  const x = r.wsi_x * scaleX.value - size / 2;
  const y = r.wsi_y * scaleY.value - size / 2;
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${size}px`,
    height: `${size}px`,
  };
}

function markerClass(r: any) {
  const s = r.abnormality_score;
  if (s >= 0.8) return 'danger';
  if (s >= 0.6) return 'warning';
  return 'info';
}

function tooltipText(r: any) {
  const tags = r.tags ? r.tags.split(',').join('、') : '';
  return [
    `异常评分: ${(r.abnormality_score * 100).toFixed(1)}%`,
    `圆面积比: ${(r.circularity || 0).toFixed(3)}`,
    `长短轴比: ${(r.aspect_ratio || 0).toFixed(2)}`,
    `边界粗糙度: ${(r.boundary_roughness || 0).toFixed(2)}`,
    `光密度方差: ${(r.intensity_std || 0).toFixed(1)}`,
    tags ? `标签: ${tags}` : '',
  ].filter(Boolean).join('\n');
}

function handleClick(r: any) {
  emit('select', r);
}
</script>

<style scoped lang="scss">
.nucleus-overlay {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  z-index: 5;
}
.nucleus-marker {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 6px rgba(0,0,0,0.5);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .score {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 0 2px #000;
  }
  &.danger .ring { border-color: #f56c6c; box-shadow: 0 0 10px #f56c6c; background: rgba(245,108,108,0.25); }
  &.warning .ring { border-color: #e6a23c; box-shadow: 0 0 8px #e6a23c; background: rgba(230,162,60,0.22); }
  &.info .ring { border-color: #409eff; box-shadow: 0 0 6px #409eff; background: rgba(64,158,255,0.18); }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.75; }
}
</style>
