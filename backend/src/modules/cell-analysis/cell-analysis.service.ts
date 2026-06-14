import { Injectable, Logger } from '@nestjs/common';
import { WorkerPoolService } from '../worker-pool/worker-pool.service';
import { MilvusService } from '../milvus/milvus.service';
import { WsiStreamingGateway } from '../websocket/wsi-streaming.gateway';
import type {
  CellAnalysisPayload,
  CellAnalysisWorkerResponse,
  NucleusMorphologyFeatures,
} from '../worker-pool/worker-pool.types';
import type { NucleusMilvusRecord } from '../milvus/milvus.types';
import { v4 as uuidv4 } from 'uuid';

export interface CellAnalysisProgress {
  taskId: string;
  tilesProcessed: number;
  tilesTotal: number;
  totalCells: number;
  abnormalCells: number;
  anomalyScore: number;
}

@Injectable()
export class CellAnalysisService {
  private readonly logger = new Logger(CellAnalysisService.name);

  constructor(
    private readonly workerPool: WorkerPoolService,
    private readonly milvus: MilvusService,
    private readonly ws: WsiStreamingGateway,
  ) {}

  /**
   * 异步分析单个 tile (不阻塞调用方 Event Loop)
   * @param imageData base64 PNG
   */
  async analyzeSingleTile(opts: {
    taskId: string;
    slidePath: string;
    tileRow: number;
    tileCol: number;
    tileSize: number;
    overlap: number;
    scaleFactor: number;
    imageData: string;
  }): Promise<CellAnalysisWorkerResponse> {
    const payload: CellAnalysisPayload = {
      imageData: opts.imageData,
      tile_row: opts.tileRow,
      tile_col: opts.tileCol,
      tile_size: opts.tileSize,
      overlap: opts.overlap,
      scale_factor: opts.scaleFactor,
    };
    const t0 = Date.now();
    const result = await this.workerPool.submit<CellAnalysisWorkerResponse>(
      'analyze_cell_instances',
      payload,
      { timeoutMs: 60_000 },
    );

    // 持久化 Milvus (异步 fire-and-forget 或串行，这里 await 但计算已在 worker)
    if (result.nuclei?.length > 0) {
      const records = this.prepareMilvusRecords(result, opts.taskId, opts.slidePath);
      const abnormal = records.filter((r) => r.is_abnormal);
      if (abnormal.length > 0) {
        const { inserted, failed } = await this.milvus.insert(abnormal);
        if (failed > 0) {
          this.logger.warn(
            `[${opts.taskId}] tile(${opts.tileRow},${opts.tileCol}) Milvus 异常记录写入失败: ${failed}/${abnormal.length}`,
          );
        } else {
          this.logger.debug(
            `[${opts.taskId}] tile(${opts.tileRow},${opts.tileCol}) 写入 ${inserted} 条异常细胞特征向量`,
          );
        }
      }
      // 实时推送异常坐标给前端大屏
      this.ws.sendCellAnalysis(opts.taskId, {
        tile_index: result.tile_index,
        abnormal_count: result.abnormal_count,
        total_count: result.total_count,
        anomaly_score: result.anomaly_score,
        cells: abnormal.map((r) => ({
          centroid_x: r.centroid_x,
          centroid_y: r.centroid_y,
          bbox_x: r.bbox_x,
          bbox_y: r.bbox_y,
          bbox_w: r.bbox_w,
          bbox_h: r.bbox_h,
          circularity: r.circularity,
          aspect_ratio: r.aspect_ratio,
          roughness: r.roughness,
          reasons: r.abnormal_reasons as any,
        })),
      });
    }
    this.logger.verbose(
      `[${opts.taskId}] tile(${opts.tileRow},${opts.tileCol}) 细胞分析完成: ` +
        `cells=${result.total_count}, abnormal=${result.abnormal_count}, ` +
        `score=${result.anomaly_score.toFixed(3)}, elapsed=${Date.now() - t0}ms`,
    );
    return result;
  }

  private prepareMilvusRecords(
    result: CellAnalysisWorkerResponse,
    taskId: string,
    slidePath: string,
  ): NucleusMilvusRecord[] {
    const now = Date.now();
    return result.nuclei.map((n: NucleusMorphologyFeatures) => ({
      id: uuidv4(),
      vector: n.feature_vector,
      task_id: taskId,
      slide_path: slidePath,
      centroid_x: n.centroid_x,
      centroid_y: n.centroid_y,
      bbox_x: n.bbox_x,
      bbox_y: n.bbox_y,
      bbox_w: n.bbox_w,
      bbox_h: n.bbox_h,
      area: n.area,
      circularity: n.circularity,
      aspect_ratio: n.aspect_ratio,
      solidity: n.solidity,
      roughness: n.roughness,
      mean_intensity: n.mean_intensity,
      is_abnormal: n.is_abnormal,
      abnormal_reasons: n.abnormal_reasons,
      tile_row: result.tile_index[0],
      tile_col: result.tile_index[1],
      created_at: now,
    }));
  }

  /**
   * 批量分析，控制并发 (默认 2 tile 并行)
   */
  async analyzeTileBatch(
    taskId: string,
    slidePath: string,
    tiles: Array<{
      row: number;
      col: number;
      x: number;
      y: number;
      width: number;
      height: number;
      imageData: string;
    }>,
    options: { tileSize?: number; overlap?: number; scaleFactor?: number; concurrency?: number } = {},
  ): Promise<{
    totalCells: number;
    abnormalCells: number;
    maxAnomaly: number;
    avgAnomaly: number;
    perTile: Array<{ row: number; col: number; total: number; abnormal: number; score: number }>;
  }> {
    const tileSize = options.tileSize ?? 512;
    const overlap = options.overlap ?? 32;
    const scaleFactor = options.scaleFactor ?? 4;
    const concurrency = options.concurrency ?? 2;

    const perTile: any[] = [];
    let totalCells = 0, abnormalCells = 0;
    let maxAnomaly = 0, sumAnomaly = 0;

    // 分批并发
    for (let i = 0; i < tiles.length; i += concurrency) {
      const batch = tiles.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((t) =>
          this.analyzeSingleTile({
            taskId,
            slidePath,
            tileRow: t.row,
            tileCol: t.col,
            tileSize,
            overlap,
            scaleFactor,
            imageData: t.imageData,
          }),
        ),
      );
      for (const r of results) {
        totalCells += r.total_count;
        abnormalCells += r.abnormal_count;
        if (r.anomaly_score > maxAnomaly) maxAnomaly = r.anomaly_score;
        sumAnomaly += r.anomaly_score;
        perTile.push({
          row: r.tile_index[0],
          col: r.tile_index[1],
          total: r.total_count,
          abnormal: r.abnormal_count,
          score: r.anomaly_score,
        });
      }
      this.ws.sendTaskStatus(taskId, {
        cell_tiles_done: i + batch.length,
        cell_tiles_total: tiles.length,
      });
    }
    return {
      totalCells,
      abnormalCells,
      maxAnomaly,
      avgAnomaly: perTile.length > 0 ? sumAnomaly / perTile.length : 0,
      perTile,
    };
  }
}
