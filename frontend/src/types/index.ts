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

export interface TaskListResponse {
  total: number;
  items: TaskStatus[];
}

export interface ServerStatus {
  serverLive: boolean;
  modelReady: boolean;
}
