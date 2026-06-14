import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { WsiReaderService } from '../wsi-reader/wsi-reader.service';
import { TritonClientService, SrTile } from '../triton-client/triton-client.service';
import { StitchingService, BlendTile } from '../stitching/stitching.service';
import { OmeTiffService } from '../ome-tiff/ome-tiff.service';
import { WsiStreamingGateway } from '../websocket/wsi-streaming.gateway';
import { CellAnalysisService } from '../cell-analysis/cell-analysis.service';
import { CreateTaskDto, TaskStatus, TaskState } from './dto/task-management.dto';

@Injectable()
export class TaskManagementService {
  private readonly logger = new Logger(TaskManagementService.name);
  private tasks = new Map<string, TaskStatus>();
  private readonly enableNucleusAnalysis: boolean;
  private readonly nucleusSampleRate: number;
  private readonly nucleusMaxTiles: number;
  private readonly nucleusScoreThreshold: number;
  private readonly nucleusConcurrency: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly wsiReaderService: WsiReaderService,
    private readonly tritonClientService: TritonClientService,
    private readonly stitchingService: StitchingService,
    private readonly omeTiffService: OmeTiffService,
    private readonly wsGateway: WsiStreamingGateway,
    private readonly cellAnalysisService: CellAnalysisService,
  ) {
    this.enableNucleusAnalysis =
      this.configService.get<boolean>('NUCLEUS_ANALYSIS_ENABLED', true);
    this.nucleusSampleRate =
      this.configService.get<number>('NUCLEUS_SAMPLE_RATE', 0.25);
    this.nucleusMaxTiles =
      this.configService.get<number>('NUCLEUS_MAX_TILES', 32);
    this.nucleusScoreThreshold =
      this.configService.get<number>('NUCLEUS_SCORE_THRESHOLD', 0.5);
    this.nucleusConcurrency =
      this.configService.get<number>('NUCLEUS_ANALYSIS_CONCURRENCY', 2);
    this.logger.log(
      `细胞核形态学分析: enabled=${this.enableNucleusAnalysis}, sampleRate=${this.nucleusSampleRate}, ` +
        `maxTiles=${this.nucleusMaxTiles}, concurrency=${this.nucleusConcurrency}, threshold=${this.nucleusScoreThreshold}`,
    );
  }

  listTasks(state?: TaskState, offset: number = 0, limit: number = 20): {
    total: number;
    items: TaskStatus[];
  } {
    let items = Array.from(this.tasks.values());
    if (state) {
      items = items.filter((t) => t.state === state);
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return {
      total: items.length,
      items: items.slice(offset, offset + limit),
    };
  }

  getTask(taskId: string): TaskStatus {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundException(`任务不存在: ${taskId}`);
    }
    return task;
  }

  async createTask(dto: CreateTaskDto): Promise<TaskStatus> {
    const taskId = uuidv4();
    const tileSize = dto.tileSize ?? this.configService.get('wsi.tileSize', 512);
    const overlap = dto.overlap ?? this.configService.get('wsi.overlap', 32);

    const task: TaskStatus = {
      taskId,
      state: TaskState.PENDING,
      progress: 0,
      message: '任务已创建，等待执行...',
      filePath: dto.filePath,
      createdAt: Date.now(),
      nucleusAnalysis: {
        enabled: this.enableNucleusAnalysis && dto.enableNucleusAnalysis !== false,
        totalTiles: 0,
        analyzedTiles: 0,
        totalNuclei: 0,
        abnormalCount: 0,
        milvusSaved: 0,
        abnormalCells: [],
      },
    };
    this.tasks.set(taskId, task);
    this.wsGateway.broadcastTaskStatus(taskId, task);
    this.logger.log(`创建任务: ${taskId}, 文件: ${dto.filePath}`);

    this.executeTask(taskId, {
      ...dto,
      tileSize,
      overlap,
    }).catch((err) => {
      this.logger.error(`任务执行失败: ${taskId}`, err.stack);
      this.updateTask(taskId, {
        state: TaskState.FAILED,
        errorMessage: err.message,
        progress: 100,
      });
      this.wsGateway.broadcastTaskError(taskId, err.message);
    });

    return task;
  }

  cancelTask(taskId: string): TaskStatus {
    const task = this.getTask(taskId);
    if (task.state === TaskState.COMPLETED || task.state === TaskState.FAILED) {
      return task;
    }
    this.updateTask(taskId, {
      state: TaskState.CANCELLED,
      message: '任务已取消',
      progress: 100,
    });
    this.wsGateway.broadcastTaskStatus(taskId, { state: TaskState.CANCELLED });
    return this.tasks.get(taskId);
  }

  private updateTask(taskId: string, patch: Partial<TaskStatus>) {
    const current = this.tasks.get(taskId);
    if (!current) return;
    const next: TaskStatus = { ...current, ...patch };
    if (patch.nucleusAnalysis && current.nucleusAnalysis) {
      next.nucleusAnalysis = { ...current.nucleusAnalysis, ...patch.nucleusAnalysis };
    }
    this.tasks.set(taskId, next);
    this.wsGateway.broadcastTaskStatus(taskId, patch);
  }

  private async executeTask(
    taskId: string,
    options: {
      filePath: string;
      pyramidLevel: number;
      tileSize: number;
      overlap: number;
      modelName?: string;
      enableNucleusAnalysis?: boolean;
    },
  ) {
    const { filePath, pyramidLevel = 0, tileSize, overlap } = options;
    const scaleFactor = this.configService.get('triton.scaleFactor', 4);
    const doNucleusAnalysis =
      this.enableNucleusAnalysis && options.enableNucleusAnalysis !== false;

    this.updateTask(taskId, {
      state: TaskState.READING,
      message: '正在读取 WSI 图像元信息...',
      startedAt: Date.now(),
    });

    const slideInfo = await this.wsiReaderService.getSlideInfo(filePath, pyramidLevel);
    const targetLevel = slideInfo.levels[pyramidLevel] || slideInfo.levels[0];
    const { width: origWidth, height: origHeight } = targetLevel;
    const outputWidth = origWidth * scaleFactor;
    const outputHeight = origHeight * scaleFactor;

    this.updateTask(taskId, {
      originalWidth: origWidth,
      originalHeight: origHeight,
      outputWidth,
      outputHeight,
      message: `图像尺寸: ${origWidth}x${origHeight}, 放大 ${scaleFactor}x`,
    });

    const effectiveStep = tileSize - overlap;
    const gridCols = Math.ceil((origWidth - overlap) / effectiveStep);
    const gridRows = Math.ceil((origHeight - overlap) / effectiveStep);
    const totalTiles = gridRows * gridCols;

    this.updateTask(taskId, {
      totalTiles,
      processedTiles: 0,
      message: `开始处理 ${gridRows}x${gridCols} = ${totalTiles} 个切片`,
    });

    this.wsGateway.broadcastGlobal('ome_header', {
      taskId,
      width: outputWidth,
      height: outputHeight,
      tileSize: tileSize * scaleFactor,
      gridRows,
      gridCols,
    });

    const srTiles: BlendTile[] = [];
    let processed = 0;

    await this.wsiReaderService.readTilesGenerator(
      {
        filePath,
        level: pyramidLevel,
        tileSize,
        overlap,
      },
      async (tile) => {
        if (this.tasks.get(taskId)?.state === TaskState.CANCELLED) {
          throw new Error('Task cancelled');
        }

        this.updateTask(taskId, { state: TaskState.SUPER_RESOLVING });
        const sr = await this.tritonClientService.superResolve({
          imageData: tile.imageData,
          modelName: options.modelName,
          scaleFactor,
        });

        const srTile: SrTile & BlendTile = {
          row: tile.row,
          col: tile.col,
          x: tile.x * scaleFactor,
          y: tile.y * scaleFactor,
          width: sr.width,
          height: sr.height,
          imageData: sr.imageData,
        };
        srTiles.push(srTile);
        processed++;

        this.wsGateway.broadcastTaskTile(taskId, {
          row: tile.row,
          col: tile.col,
          imageData: sr.imageData,
        });

        const readProgress = (processed / totalTiles) * 60;
        this.updateTask(taskId, {
          processedTiles: processed,
          progress: readProgress,
          message: `超分处理: ${processed}/${totalTiles} (${readProgress.toFixed(1)}%)`,
        });
        this.wsGateway.broadcastTaskProgress(taskId, readProgress, `已完成 ${processed}/${totalTiles}`);
      },
    );

    this.updateTask(taskId, {
      state: TaskState.STITCHING,
      progress: 75,
      message: '正在执行高斯混合拼接...',
    });
    this.wsGateway.broadcastTaskProgress(taskId, 75, '正在拼接图像');

    const outputFileName = `${taskId}.png`;
    const blendResult = await this.stitchingService.blendTiles(
      srTiles,
      origWidth,
      origHeight,
      {
        tileSize,
        overlap,
        scaleFactor,
        outputFileName,
      },
    );

    this.updateTask(taskId, {
      state: TaskState.SAVING,
      progress: 90,
      message: '正在保存 OME-TIFF 文件...',
      outputPath: blendResult.outputPath,
    });
    this.wsGateway.broadcastTaskProgress(taskId, 90, '正在保存文件');

    const tiffOutputPath = this.omeTiffService.getOutputPath(taskId);

    // ---------- 细胞核分析流水线 (拼接完成后后台执行) ----------
    if (doNucleusAnalysis && srTiles.length > 0) {
      this.runNucleusAnalysisAsync(taskId, {
        srTiles,
        outputWidth,
        outputHeight,
        scaleFactor,
      }).catch((err) => {
        this.logger.warn(`细胞核分析失败 (不影响主任务): ${taskId}`, err.message);
      });
    }

    this.updateTask(taskId, {
      state: TaskState.COMPLETED,
      progress: 100,
      message: '任务完成' + (doNucleusAnalysis ? '，细胞核分析后台运行中' : ''),
      outputPath: tiffOutputPath,
      thumbnail: blendResult.imageData || undefined,
      completedAt: Date.now(),
    });

    this.wsGateway.broadcastTaskComplete(taskId, tiffOutputPath, blendResult.imageData);
    this.logger.log(`任务完成: ${taskId}, 输出: ${tiffOutputPath}`);
  }

  /**
   * 采样 + 并发执行细胞核形态学分析
   * Worker Threads 内部完成 CPU 密集计算 (Otsu/连通域/协方差椭圆/128维特征向量)
   * Milvus 向量持久化在 CellAnalysisService 内完成
   * 后台异步运行，不阻塞主任务完成
   */
  private async runNucleusAnalysisAsync(
    taskId: string,
    ctx: {
      srTiles: BlendTile[];
      outputWidth: number;
      outputHeight: number;
      scaleFactor: number;
    },
  ) {
    const t0 = Date.now();
    this.logger.log(
      `[Nucleus] 启动后台细胞核形态学分析: taskId=${taskId}, tiles=${ctx.srTiles.length}`,
    );

    const total = ctx.srTiles.length;
    const sampleCount = Math.max(1, Math.min(
      this.nucleusMaxTiles,
      Math.ceil(total * this.nucleusSampleRate),
    ));
    const sampled: BlendTile[] = [];
    if (sampleCount >= total) {
      sampled.push(...ctx.srTiles);
    } else {
      const step = total / sampleCount;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.min(total - 1, Math.floor(i * step));
        sampled.push(ctx.srTiles[idx]);
      }
    }

    this.updateTask(taskId, {
      nucleusAnalysis: {
        enabled: true,
        totalTiles: sampled.length,
        analyzedTiles: 0,
        totalNuclei: 0,
        abnormalCount: 0,
        milvusSaved: 0,
        abnormalCells: [],
      },
    });

    try {
      const task = this.tasks.get(taskId);
      const slidePath = task?.filePath || taskId;
      const summary = await this.cellAnalysisService.analyzeTileBatch(
        taskId,
        slidePath,
        sampled,
        { concurrency: this.nucleusConcurrency },
      );
      this.updateTask(taskId, {
        nucleusAnalysis: {
          enabled: true,
          totalTiles: sampled.length,
          analyzedTiles: summary.perTile.length,
          totalNuclei: summary.totalCells,
          abnormalCount: summary.abnormalCells,
          milvusSaved: summary.abnormalCells,
          maxAnomaly: summary.maxAnomaly,
          avgAnomaly: summary.avgAnomaly,
          perTile: summary.perTile,
          abnormalCells: [],
        },
        message: `细胞核形态学分析完成: ${summary.totalCells} 个细胞核, ${summary.abnormalCells} 个异常, 最高异常分=${summary.maxAnomaly.toFixed(3)} (${Date.now() - t0}ms)`,
      });
      this.wsGateway.broadcastGlobal('nucleus_analysis_complete', {
        taskId,
        totalNuclei: summary.totalCells,
        abnormalCount: summary.abnormalCells,
        milvusSaved: summary.abnormalCells,
        maxAnomaly: summary.maxAnomaly,
        avgAnomaly: summary.avgAnomaly,
        durationMs: Date.now() - t0,
      });
      this.logger.log(
        `[Nucleus] 完成: taskId=${taskId}, cells=${summary.totalCells}, abnormal=${summary.abnormalCells}, ` +
          `score=[avg=${summary.avgAnomaly.toFixed(3)}, max=${summary.maxAnomaly.toFixed(3)}], ` +
          `elapsed=${Date.now() - t0}ms`,
      );
    } catch (err) {
      this.logger.error(`[Nucleus] 失败: taskId=${taskId}`, (err as Error).stack);
      this.updateTask(taskId, {
        message: `细胞核分析失败: ${(err as Error).message}`,
      });
    }
  }
}
