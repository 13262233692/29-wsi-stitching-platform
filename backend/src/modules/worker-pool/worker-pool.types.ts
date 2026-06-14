import { Worker } from 'worker_threads';
import { join } from 'path';

export type WorkerTaskKind =
  | 'blend_tiles'
  | 'decode_image_batch'
  | 'encode_image'
  | 'generate_weight_map'
  | 'analyze_cell_instances';

export interface WorkerTask {
  id: string;
  kind: WorkerTaskKind;
  payload: any;
}

export interface WorkerTaskResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}

export interface BlendTilesPayload {
  tiles: Array<{
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    height: number;
    imageData: string;
  }>;
  totalWidth: number;
  totalHeight: number;
  tileSize: number;
  overlap: number;
  scaleFactor: number;
  outputPath?: string;
  returnBase64?: boolean;
}

export interface DecodeImageBatchPayload {
  tiles: Array<{ imageData: string }>;
}

export interface EncodeImagePayload {
  rgbaBuffer: Uint8ClampedArray;
  width: number;
  height: number;
  format?: 'png' | 'jpeg';
}

export interface GenerateWeightPayload {
  tileSize: number;
  overlap: number;
}

export interface NucleusMorphologyFeatures {
  cell_id: number;
  centroid_x: number;
  centroid_y: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  area: number;
  perimeter: number;
  convex_perimeter: number;
  major_axis: number;
  minor_axis: number;
  orientation: number;
  circularity: number;
  aspect_ratio: number;
  solidity: number;
  roughness: number;
  mean_intensity: number;
  is_abnormal: boolean;
  abnormal_reasons: string[];
  feature_vector: number[];
}

export interface CellAnalysisPayload {
  imageData: string;
  tile_row: number;
  tile_col: number;
  tile_size: number;
  overlap: number;
  scale_factor: number;
}

export interface CellAnalysisWorkerResponse {
  tile_index: [number, number];
  tile_offset: [number, number];
  tile_size: number;
  scale_factor: number;
  nuclei: NucleusMorphologyFeatures[];
  abnormal_count: number;
  total_count: number;
  density: number;
  anomaly_score: number;
  thumbnail_b64?: string;
}
