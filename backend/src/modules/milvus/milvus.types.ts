export interface MilvusConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  collectionName: string;
  vectorDim: number;
  indexType: 'IVF_FLAT' | 'HNSW' | 'IVF_PQ' | 'DISKANN';
  metricType: 'L2' | 'IP' | 'COSINE';
}

export interface NucleusMilvusRecord {
  id: string;
  vector: number[];
  task_id: string;
  slide_path: string;
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
  abnormal_reasons: string;
  tile_row: number;
  tile_col: number;
  created_at: number;
}
