import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { WsiReaderService } from '../wsi-reader/wsi-reader.service';
import { TritonClientService, SrTile } from '../triton-client/triton-client.service';
import { StitchingService, BlendTile } from '../stitching/stitching.service';
import { OmeTiffService } from '../ome-tiff/ome-tiff.service';
import { WsiStreamingGateway } from '../websocket/wsi-streaming.gateway';
import { CreateTaskDto, TaskStatus, TaskState } from './dto/task-management.dto';

@Injectable()
export class TaskManagementService {
  private readonly logger = new Logger(TaskManagementService.name);
  private tasks = new Map<string, TaskStatus>();

  constructor(
    private readonly configService: ConfigService,
    private readonly wsiReaderService: WsiReaderService,
    private readonly tritonClientService: TritonClientService,
    private readonly stitchingService: StitchingService,
    private readonly omeTiffService: OmeTiffService,
    private readonly wsGateway: WsiStreamingGateway,
  ) {}

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
    const next = { ...current, ...patch };
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
    },
  ) {
    const { filePath, pyramidLevel = 0, tileSize, overlap } = options;
    const scaleFactor = this.configService.get('triton.scaleFactor', 4);

    this.updateTask(taskId, {
      state: TaskState.READING,
      message: '正在读取 WSI 图像元信息...',
      startedAt: Date.now(),
    });

    const slideInfo = await this.wsiReaderService.getSlideInfo(filePath, pyramidLevel);
    const targetLevel = slideInfo.levels[pyramidLevel] || slideInfo.levels[0];
    const { width: origWidth, height: origHeight } = targetLevel;

    this.updateTask(taskId, {
      originalWidth: origWidth,
      originalHeight: origHeight,
      outputWidth: origWidth * scaleFactor,
      outputHeight: origHeight * scaleFactor,
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
      width: origWidth * scaleFactor,
      height: origHeight * scaleFactor,
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

    this.updateTask(taskId, {
      state: TaskState.COMPLETED,
      progress: 100,
      message: '任务完成',
      outputPath: tiffOutputPath,
      thumbnail: blendResult.imageData || undefined,
      completedAt: Date.now(),
    });

    this.wsGateway.broadcastTaskComplete(taskId, tiffOutputPath, blendResult.imageData);
    this.logger.log(`任务完成: ${taskId}, 输出: ${tiffOutputPath}`);
  }
}
