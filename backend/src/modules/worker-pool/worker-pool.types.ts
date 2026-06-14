import { Worker } from 'worker_threads';
import { join } from 'path';

export type WorkerTaskKind =
  | 'blend_tiles'
  | 'decode_image_batch'
  | 'encode_image'
  | 'generate_weight_map';

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
