<template>
  <div class="nucleus-feature-panel panel">
    <div class="panel-header">
      <span class="title glow-text">
        <el-icon><Histogram /></el-icon>
        细胞核形态学分析
      </span>
      <el-tag size="small" effect="dark" :type="statusTag">
        {{ statusText }}
      </el-tag>
    </div>

    <div class="stats-grid" v-if="status">
      <div class="stat">
        <div class="k">采样 Tile</div>
        <div class="v mono">{{ status.analyzedTiles }} / {{ status.totalTiles }}</div>
      </div>
      <div class="stat">
        <div class="k">检测细胞核</div>
        <div class="v mono">{{ status.totalNuclei }}</div>
      </div>
      <div class="stat danger">
        <div class="k">异常细胞</div>
        <div class="v mono">{{ status.abnormalCount }}</div>
      </div>
      <div class="stat">
        <div class="k">Milvus 入库</div>
        <div class="v mono">{{ status.milvusSaved }}</div>
      </div>
    </div>

    <div v-if="status?.abnormalCount > 0" class="section-divider"></div>

    <div v-if="status?.abnormalCount > 0" class="list-header">
      <span>异常细胞 Top 列表 (按评分)</span>
      <el-button size="small" text @click="$emit('load-all')">
        从 Milvus 加载全部
      </el-button>
    </div>

    <div class="abnormal-list" v-if="abnormalList.length > 0">
      <div
        v-for="r in abnormalList"
        :key="r.id || `${r.inst_id}-${r.tile_row}-${r.tile_col}`"
        class="abnormal-item"
        :class="{ active: selectedId === (r.id || `${r.inst_id}-${r.tile_row}-${r.tile_col}`) }"
        @click="handleSelect(r)"
      >
        <div class="row1">
          <div class="pos mono">
            ({{ r.wsi_x ?? (r.tile_global_offset?.[0] + (r.centroid?.[0] || 0)) }},
             {{ r.wsi_y ?? (r.tile_global_offset?.[1] + (r.centroid?.[1] || 0)) }})
          </div>
          <el-tag size="small" :type="scoreTagType(r.abnormality_score)">
            {{ (r.abnormality_score * 100).toFixed(0) }}%
          </el-tag>
        </div>
        <div class="tags">
          <el-tag
            v-for="tag in (r.tags || r.abnormality_tags || '').split(',').filter(Boolean)"
            :key="tag"
            size="small"
            effect="plain"
          >
            {{ tagLabel(tag) }}
          </el-tag>
        </div>
        <div class="features">
          <span>圆 {{ (r.circularity || 0).toFixed(2) }}</span>
          <span>轴 {{ (r.aspect_ratio || 0).toFixed(2) }}</span>
          <span>糙 {{ (r.boundary_roughness || 0).toFixed(2) }}</span>
          <span>密 {{ (r.intensity_std || 0).toFixed(0) }}</span>
        </div>
      </div>
    </div>
    <el-empty v-else description="暂无异常细胞" :image-size="60" />

    <div v-if="status?.abnormalCount > 0" class="section-divider"></div>

    <div class="similar-search">
      <div class="search-title">
        <el-icon><Search /></el-icon> Milvus 相似度检索
      </div>
      <div v-if="!selectedItem" class="hint">点击上方异常细胞启动检索</div>
      <div v-else>
        <el-button size="small" type="primary" :loading="searching" @click="doSearch">
          检索全局相似形态 (Top {{ topK }})
        </el-button>
        <div class="search-results" v-if="searchResults.length > 0">
          <div
            v-for="s in searchResults"
            :key="s.id"
            class="search-result"
          >
            <div class="meta">
              <span class="mono">task: {{ s.task_id.slice(0, 8) }}</span>
              <el-tag size="small" type="danger">
                {{ ((s._score || 0) * 100).toFixed(1) }}%
              </el-tag>
            </div>
            <div class="mono small">
              ({{ s.wsi_x }}, {{ s.wsi_y }}) · {{ s.tags }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NucleusAnalysisStatus, NucleusFeature, MilvusRecord } from '@/types';
import { searchSimilarNuclei } from '@/api';

const props = defineProps<{
  status?: NucleusAnalysisStatus | null;
  abnormalFromStore: NucleusFeature[];
  selectedId?: string | null;
}>(); 

const emit = defineEmits<{
  (e: 'select', r: any): void;
  (e: 'load-all'): void;
}>();

const searching = ref(false);
const searchResults = ref<MilvusRecord[]>([]);
const selectedItem = ref<any>(null);
const topK = ref(10);

const abnormalList = computed(() => {
  const fromStatus = props.status?.abnormalCells || [];
  const merged = [...fromStatus, ...props.abnormalFromStore];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of merged) {
    const k = `${r.tile_row}_${r.tile_col}_${r.inst_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out
    .sort((a, b) => b.abnormality_score - a.abnormality_score)
    .slice(0, 50);
});

const statusText = computed(() => {
  if (!props.status || !props.status.enabled) return '未启用';
  if (props.status.totalTiles === 0) return '等待中';
  if (props.status.analyzedTiles < props.status.totalTiles) return '分析中';
  return '已完成';
});

const statusTag = computed(() => {
  if (!props.status || !props.status.enabled) return 'info';
  if (statusText.value === '分析中') return 'warning';
  if (props.status.abnormalCount > 0) return 'danger';
  return 'success';
} as const);

function scoreTagType(s: number) {
  if (s >= 0.8) return 'danger';
  if (s >= 0.6) return 'warning';
  return 'primary';
}

function tagLabel(tag: string) {
  const map: Record<string, string> = {
    polygonal: '多角形',
    rough_boundary: '粗糙边界',
    spindle: '梭形',
    chromatin_aggregation: '染色质聚集',
    morphology_suspected: '疑似异型',
  };
  return map[tag] || tag;
}

function handleSelect(r: any) {
  selectedItem.value = r;
  emit('select', r);
}

async function doSearch() {
  if (!selectedItem.value?.feature_vector) return;
  searching.value = true;
  try {
    const res = await searchSimilarNuclei({
      featureVector: selectedItem.value.feature_vector,
      topK: topK.value,
    });
    searchResults.value = res.items || [];
  } finally {
    searching.value = false;
  }
}

watch(
  () => props.selectedId,
  () => {
    searchResults.value = [];
    selectedItem.value = null;
  },
);
</script>

<style scoped lang="scss">
.nucleus-feature-panel {
  padding: 12px 14px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  .title {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  .stat {
    background: rgba(64, 158, 255, 0.08);
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid rgba(64, 158, 255, 0.15);
    .k { color: #8b9cb5; font-size: 11px; }
    .v { font-size: 15px; font-weight: 700; color: #e0e6ed; }
    &.danger .v { color: #f56c6c; }
  }
}
.section-divider {
  height: 1px;
  background: rgba(64, 158, 255, 0.15);
  margin: 10px 0;
}
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8b9cb5;
  margin-bottom: 8px;
}
.abnormal-list {
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.abnormal-item {
  padding: 8px 10px;
  border: 1px solid rgba(64, 158, 255, 0.15);
  border-radius: 4px;
  background: rgba(10, 14, 26, 0.5);
  cursor: pointer;
  transition: all 0.15s;
  &:hover, &.active {
    border-color: #f56c6c;
    background: rgba(245, 108, 108, 0.1);
  }
  .row1 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    .pos { font-size: 11px; color: #b0c4de; }
  }
  .tags {
    margin-top: 4px;
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .features {
    display: flex;
    gap: 10px;
    margin-top: 4px;
    font-size: 11px;
    color: #8b9cb5;
    font-family: 'Courier New', monospace;
  }
}
.similar-search {
  .search-title {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: #409eff;
    margin-bottom: 8px;
  }
  .hint { font-size: 12px; color: #8b9cb5; }
  .search-results {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow: auto;
  }
  .search-result {
    padding: 6px 8px;
    background: rgba(64, 158, 255, 0.06);
    border-radius: 4px;
    .meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .small {
      font-size: 11px;
      color: #8b9cb5;
      margin-top: 2px;
    }
  }
}
.mono { font-family: 'Courier New', monospace; }
</style>
