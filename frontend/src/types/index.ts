export type TaskState =
  | 'pending'
  | 'reading'
  | 'super_resolving'
  | 'stitching'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskStatus {
  taskId: string;
  state: TaskState;
  progress: number;
  message: string;
  filePath: string;
  originalWidth?: number;
  originalHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  outputPath?: string;
  thumbnail?: string;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  totalTiles?: number;
  processedTiles?: number;
  nucleusAnalysis?: NucleusAnalysisStatus;
}

export interface CreateTaskRequest {
  filePath: string;
  pyramidLevel?: number;
  tileSize?: number;
  overlap?: number;
  modelName?: string;
}

export interface SlideLevelInfo {
  level: number;
  width: number;
  height: number;
  downsample: number;
}

export interface SlideInfo {
  filePath: string;
  levelCount: number;
  levels: SlideLevelInfo[];
  metadata: Record<string, string>;
}

export interface TileInfo {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData: string;
}

export interface TileBatchResult {
  tiles: TileInfo[];
  gridRows: number;
  gridCols: number;
  totalWidth: number;
  totalHeight: number;
}

export interface NucleusAbnormalCell {
  id?: string;
  centroid_x: number;
  centroid_y: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  area: number;
  circularity: number;
  aspect_ratio: number;
  solidity: number;
  roughness: number;
  mean_intensity: number;
  is_abnormal: boolean;
  abnormal_reasons: string[];
  tile_row?: number;
  tile_col?: number;
  score?: number;
  distance?: number;
}

export interface NucleusAnalysisResult {
  tile_index: [number, number];
  tile_offset: [number, number];
  abnormal_count: number;
  total_count: number;
  anomaly_score: number;
  cells: NucleusAbnormalCell[];
  timestamp: number;
}

export interface NucleusAnalysisProgress {
  enabled: boolean;
  totalTiles: number;
  analyzedTiles: number;
  totalNuclei: number;
  abnormalCount: number;
  milvusSaved: number;
  maxAnomaly?: number;
  avgAnomaly?: number;
  abnormalCells?: NucleusAbnormalCell[];
  perTile?: Array<{ row: number; col: number; total: number; abnormal: number; score: number }>;
}

export interface TaskListResponse {
  total: number;
  items: TaskStatus[];
}

export interface ServerStatus {
  serverLive: boolean;
  modelReady: boolean;
}

// ---------- 细胞核形态学分析 ----------
export interface NucleusFeature {
  inst_id: number;
  centroid: number[];
  bbox: number[];
  area: number;
  circularity: number;
  aspect_ratio: number;
  solidity: number;
  boundary_roughness: number;
  ecd: number;
  rectangularity: number;
  fractal_dim: number;
  intensity_std: number;
  abnormality_score: number;
  abnormality_tags: string[];
  sub_scores?: Record<string, number>;
  feature_vector: number[];
  tile_row?: number;
  tile_col?: number;
  tile_global_offset?: number[];
}

export interface AnalyzeTileResult {
  task_id: string;
  total_nuclei: number;
  abnormal_count: number;
  milvus_saved: number;
  abnormal: NucleusFeature[];
  all_count: number;
  all: NucleusFeature[];
}

export interface MilvusRecord {
  id: string;
  task_id: string;
  wsi_x: number;
  wsi_y: number;
  wsi_width: number;
  wsi_height: number;
  tile_row: number;
  tile_col: number;
  inst_id: number;
  circularity: number;
  aspect_ratio: number;
  boundary_roughness: number;
  intensity_std: number;
  abnormality_score: number;
  tags: string;
  created_at: number;
  _distance?: number;
  _score?: number;
}

export interface NucleusAnalysisStatus {
  enabled: boolean;
  totalTiles: number;
  analyzedTiles: number;
  totalNuclei: number;
  abnormalCount: number;
  milvusSaved: number;
  abnormalCells: NucleusFeature[];
}
