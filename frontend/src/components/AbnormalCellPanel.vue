<template>
  <div class="abnormal-cell-panel panel">
    <div class="panel-header">
      <div class="title">
        <el-icon color="#f56c6c"><Warning /></el-icon>
        <span>异常细胞核 ({{ totalAbnormal }})</span>
      </div>
      <div class="header-actions">
        <el-tag v-if="milvusAvailable" type="success" size="small" effect="dark">
          Milvus 已连接
        </el-tag>
        <el-tag v-else type="warning" size="small">Milvus 离线</el-tag>
        <el-button size="small" :icon="Refresh" @click="load" :loading="loading">刷新</el-button>
      </div>
    </div>

    <div v-if="summary" class="summary-row">
      <div class="summary-item">
        <div class="k">总检测细胞</div>
        <div class="v">{{ summary.totalNuclei || 0 }}</div>
      </div>
      <div class="summary-item">
        <div class="k">异常细胞</div>
        <div class="v red">{{ summary.abnormalCount || 0 }}</div>
      </div>
      <div class="summary-item">
        <div class="k">最高异常分</div>
        <div class="v orange">{{ (summary.maxAnomaly || 0).toFixed(3) }}</div>
      </div>
      <div class="summary-item">
        <div class="k">已分析 Tiles</div>
        <div class="v">{{ summary.analyzedTiles || 0 }} / {{ summary.totalTiles || 0 }}</div>
      </div>
    </div>

    <div class="search-bar">
      <el-input
        v-model="searchText"
        placeholder="按细胞 ID / 特征搜索..."
        clearable
        size="small"
      />
      <el-button size="small" :disabled="!selectedCell" @click="handleSearchSimilar">
        检索相似细胞
      </el-button>
    </div>

    <div class="cell-list" v-loading="loading">
      <div
        v-for="cell in filteredCells"
        :key="cell.id || cell.centroid_x + '_' + cell.centroid_y"
        class="cell-card"
        :class="{ active: selectedCell?.centroid_x === cell.centroid_x && selectedCell?.centroid_y === cell.centroid_y }"
        @click="handleSelect(cell)"
      >
        <div class="cell-header">
          <el-badge :value="cell.abnormal_reasons?.length || 0" type="danger" size="small">
            <span class="cell-id">细胞 #{{ cell.id?.slice(-6) || Math.round(cell.centroid_x) }}</span>
          </el-badge>
          <el-tag size="small" v-if="cell.abnormal_reasons?.includes('low_circularity')" type="danger" effect="dark">
            非规则
          </el-tag>
          <el-tag size="small" v-else-if="cell.abnormal_reasons?.includes('high_aspect_ratio')" type="warning" effect="dark">
            拉长
          </el-tag>
          <el-tag size="small" v-else-if="cell.abnormal_reasons?.includes('high_roughness')" type="warning" effect="dark">
            毛糙
          </el-tag>
        </div>

        <div class="cell-meta">
          <div class="meta-row">
            <span class="k">位置</span>
            <span class="v mono">({{ Math.round(cell.centroid_x) }}, {{ Math.round(cell.centroid_y) }})</span>
          </div>
          <div class="meta-row">
            <span class="k">圆面积比</span>
            <span class="v" :class="{ bad: cell.circularity < 0.55 }">{{ cell.circularity.toFixed(3) }}</span>
          </div>
          <div class="meta-row">
            <span class="k">长短轴比</span>
            <span class="v" :class="{ bad: cell.aspect_ratio > 2.2 }">{{ cell.aspect_ratio.toFixed(2) }}</span>
          </div>
          <div class="meta-row">
            <span class="k">边界粗糙度</span>
            <span class="v" :class="{ bad: cell.roughness > 1.35 }">{{ cell.roughness.toFixed(3) }}</span>
          </div>
          <div class="meta-row">
            <span class="k">面积</span>
            <span class="v">{{ Math.round(cell.area) }} px²</span>
          </div>
        </div>

        <div class="cell-reasons" v-if="cell.abnormal_reasons?.length">
          <el-tag size="small" v-for="r in cell.abnormal_reasons" :key="r" class="reason-tag">
            {{ reasonLabel(r) }}
          </el-tag>
        </div>

        <div class="cell-actions" v-if="cell.feature_vector">
          <el-button text size="small" @click.stop="handleShowFeatureVector(cell)">
            <el-icon><DataLine /></el-icon>特征向量
          </el-button>
          <el-button text size="small" type="primary" @click.stop="handleSearchSimilar(cell)">
            <el-icon><Search /></el-icon>找相似
          </el-button>
          <el-button text size="small" @click.stop="handleLocate(cell)">
            <el-icon><Aim /></el-icon>定位
          </el-button>
        </div>
      </div>
      <el-empty v-if="filteredCells.length === 0" description="暂无异常细胞数据" />
    </div>

    <el-dialog
      v-model="featureDialogVisible"
      title="128 维形态学特征向量"
      width="560px"
    >
      <div v-if="selectedCell" class="feature-vector-view">
        <div class="vector-header">
          <div class="label">细胞 ID: {{ selectedCell.id || '-' }}</div>
          <div class="label">维度: {{ selectedCell.feature_vector?.length || 128 }}</div>
        </div>
        <div class="vector-grid">
          <div
            v-for="(v, i) in selectedCell.feature_vector"
            :key="i"
            class="vec-cell"
            :style="{ opacity: Math.max(0.2, Math.abs(v)) }"
            :title="`[${i}] = ${v.toFixed(4)}`"
          >
            {{ v > 0 ? '+' : '' }}{{ v.toFixed(2) }}
          </div>
        </div>
        <div class="legend">
          <span>颜色深浅代表绝对值大小</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Refresh, Warning, DataLine, Search, Aim } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { NucleusAbnormalCell, NucleusAnalysisProgress } from '@/types';
import { listAbnormalCells, searchSimilarCells } from '@/api';

const props = defineProps<{
  taskId: string | null;
  nucleusAnalysis?: NucleusAnalysisProgress | null;
  milvusAvailable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', cell: NucleusAbnormalCell): void;
  (e: 'locate', cell: NucleusAbnormalCell): void;
  (e: 'search-similar', cell: NucleusAbnormalCell): void;
}>();

const loading = ref(false);
const searchText = ref('');
const cells = ref<NucleusAbnormalCell[]>([]);
const selectedCell = ref<NucleusAbnormalCell | null>(null);
const featureDialogVisible = ref(false);

const totalAbnormal = computed(() => props.nucleusAnalysis?.abnormalCount || cells.value.length);
const summary = computed(() => props.nucleusAnalysis);

const filteredCells = computed(() => {
  if (!searchText.value.trim()) return cells.value;
  const kw = searchText.value.toLowerCase();
  return cells.value.filter((c) =>
    String(c.id).toLowerCase().includes(kw) ||
    String(c.centroid_x).includes(kw) ||
    String(c.centroid_y).includes(kw) ||
    c.abnormal_reasons?.some((r) => r.includes(kw)),
  );
});

function reasonLabel(r: string): string {
  const map: Record<string, string> = {
    low_circularity: '偏离圆形',
    high_aspect_ratio: '过度拉长',
    high_roughness: '边界毛糙',
    low_solidity: '凸性不足',
    abnormal_size: '尺寸异常',
  };
  return map[r] || r;
}

async function load() {
  if (!props.taskId) return;
  loading.value = true;
  try {
    const res = await listAbnormalCells(props.taskId);
    cells.value = res.items || [];
  } catch (err: any) {
    ElMessage.error(err.message || '加载异常细胞失败');
  } finally {
    loading.value = false;
  }
}

function handleSelect(cell: NucleusAbnormalCell) {
  selectedCell.value = cell;
  emit('select', cell);
}

function handleLocate(cell: NucleusAbnormalCell) {
  emit('locate', cell);
}

function handleShowFeatureVector(cell: NucleusAbnormalCell) {
  selectedCell.value = cell;
  featureDialogVisible.value = true;
}

async function handleSearchSimilar(cell?: NucleusAbnormalCell) {
  const target = cell || selectedCell.value;
  if (!target?.feature_vector) {
    ElMessage.warning('该细胞无特征向量');
    return;
  }
  if (!props.taskId) return;
  try {
    const res = await searchSimilarCells(props.taskId, target.feature_vector, { topK: 20 });
    cells.value = res.results || [];
    emit('search-similar', target);
    ElMessage.success(`已找到 ${cells.value.length} 个相似细胞`);
  } catch (err: any) {
    ElMessage.error(err.message || '检索失败');
  }
}

watch(
  () => props.taskId,
  (id) => {
    if (id) {
      load();
      cells.value = [];
      selectedCell.value = null;
    }
  },
  { immediate: true },
);

defineExpose({ load, selectedCell });
</script>

<style scoped lang="scss">
.abnormal-cell-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 400px;
  padding: 0;
  overflow: hidden;

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(64, 158, 255, 0.2);
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 15px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .summary-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding: 10px 16px;
    background: rgba(64, 158, 255, 0.04);
    border-bottom: 1px solid rgba(64, 158, 255, 0.1);
    .summary-item {
      text-align: center;
      .k { color: #8b9cb5; font-size: 12px; }
      .v { font-size: 18px; font-weight: 600; color: #e0e6ed; margin-top: 2px; }
      .v.red { color: #f56c6c; }
      .v.orange { color: #e6a23c; }
    }
  }

  .search-bar {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(64, 158, 255, 0.1);
  }

  .cell-list {
    flex: 1;
    overflow: auto;
    padding: 10px 16px;
    .cell-card {
      background: rgba(64, 158, 255, 0.04);
      border: 1px solid rgba(245, 108, 108, 0.2);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.15s;
      &:hover, &.active {
        border-color: rgba(245, 108, 108, 0.6);
        background: rgba(245, 108, 108, 0.08);
      }
      .cell-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        .cell-id {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          color: #e0e6ed;
          margin-right: 6px;
        }
      }
      .cell-meta {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px 12px;
        font-size: 12px;
        .meta-row {
          display: flex;
          justify-content: space-between;
          .k { color: #8b9cb5; }
          .v { color: #e0e6ed; }
          .v.bad { color: #f56c6c; font-weight: 600; }
          .mono { font-family: 'Courier New', monospace; }
        }
      }
      .cell-reasons {
        margin-top: 8px;
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        .reason-tag { font-size: 11px; }
      }
      .cell-actions {
        margin-top: 8px;
        display: flex;
        gap: 10px;
        border-top: 1px solid rgba(245, 108, 108, 0.1);
        padding-top: 8px;
      }
    }
  }
}

.feature-vector-view {
  .vector-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    color: #8b9cb5;
    font-size: 12px;
  }
  .vector-grid {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 2px;
    .vec-cell {
      font-size: 9px;
      font-family: 'Courier New', monospace;
      padding: 2px 0;
      text-align: center;
      background: rgba(64, 158, 255, 0.15);
      border-radius: 2px;
      color: #e0e6ed;
    }
  }
  .legend {
    margin-top: 10px;
    color: #8b9cb5;
    font-size: 12px;
    text-align: right;
  }
}
</style>
