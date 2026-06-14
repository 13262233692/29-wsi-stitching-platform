import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PythonShell } from 'python-shell';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { WorkerPoolService } from '../worker-pool/worker-pool.service';
import type { BlendTilesPayload, GenerateWeightPayload } from '../worker-pool/worker-pool.types';

export interface BlendTile {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData: string;
}

export interface BlendResult {
  imageData?: string;
  outputPath: string;
  width: number;
  height: number;
  durationMs?: number;
  usedWorker?: boolean;
}

@Injectable()
export class StitchingService implements OnModuleInit {
  private readonly logger = new Logger(StitchingService.name);
  private pythonScriptDir: string;
  private outputDir: string;
  private usePythonFallback = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly workerPool: WorkerPoolService,
  ) {}

  onModuleInit() {
    this.pythonScriptDir = join(process.cwd(), '..', 'python-service', 'src', 'blending');
    this.outputDir = join(process.cwd(), 'data', 'output');
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    this.logger.log(
      `拼接服务初始化: worker 线程池已启用 (size=${this.workerPool.stats().poolSize})，Python fallback 目录: ${this.pythonScriptDir}`,
    );
  }

  async blendTiles(
    tiles: BlendTile[],
    totalWidth: number,
    totalHeight: number,
    options: {
      tileSize?: number;
      overlap?: number;
      scaleFactor?: number;
      outputFileName?: string;
      returnBase64?: boolean;
      forcePython?: boolean;
    } = {},
  ): Promise<BlendResult> {
    const tileSize = options.tileSize ?? this.configService.get('wsi.tileSize', 512);
    const overlap = options.overlap ?? this.configService.get('wsi.overlap', 32);
    const scaleFactor = options.scaleFactor ?? this.configService.get('triton.scaleFactor', 4);
    const outputFileName = options.outputFileName ?? `stitched-${Date.now()}.png`;
    const outputPath = join(this.outputDir, outputFileName);

    if (!options.forcePython && !this.usePythonFallback) {
      try {
        const payload: BlendTilesPayload = {
          tiles: tiles.map((t) => ({
            row: t.row,
            col: t.col,
            x: t.x,
            y: t.y,
            width: t.width,
            height: t.height,
            imageData: t.imageData,
          })),
          totalWidth,
          totalHeight,
          tileSize,
          overlap,
          scaleFactor,
          outputPath,
          returnBase64: !!options.returnBase64,
        };

        const t0 = Date.now();
        const result = await this.workerPool.submit<any>('blend_tiles', payload, {
          timeoutMs: Math.max(60_000, tiles.length * 800),
        });
        this.logger.log(
          `Worker 线程池拼接完成: tiles=${tiles.length}, out=${result.width}x${result.height}, elapsed=${Date.now() - t0}ms, worker=${result.durationMs}ms`,
        );
        return {
          imageData: result.imageData,
          outputPath: result.outputPath || outputPath,
          width: result.width || totalWidth * scaleFactor,
          height: result.height || totalHeight * scaleFactor,
          durationMs: result.durationMs,
          usedWorker: true,
        };
      } catch (err) {
        this.logger.warn(
          `Worker 线程池拼接失败，fallback 到 Python 子进程: ${(err as Error).message}`,
        );
      }
    }

    return this.blendTilesPython(
      tiles, totalWidth, totalHeight,
      { tileSize, overlap, scaleFactor, outputFileName, returnBase64: options.returnBase64 },
    );
  }

  private async blendTilesPython(
    tiles: BlendTile[],
    totalWidth: number,
    totalHeight: number,
    options: {
      tileSize: number;
      overlap: number;
      scaleFactor: number;
      outputFileName: string;
      returnBase64?: boolean;
    },
  ): Promise<BlendResult> {
    const { tileSize, overlap, scaleFactor, outputFileName, returnBase64 } = options;
    const outputPath = join(this.outputDir, outputFileName);
    const tilesJsonPath = join(this.outputDir, `tiles-${Date.now()}.json`);
    writeFileSync(
      tilesJsonPath,
      JSON.stringify(
        tiles.map((t) => ({
          row: t.row,
          col: t.col,
          x: t.x,
          y: t.y,
          image_data: t.imageData,
        })),
      ),
    );
    try {
      const args: Record<string, any> = {
        action: 'blend',
        tiles_json: tilesJsonPath,
        total_width: totalWidth,
        total_height: totalHeight,
        tile_size: tileSize,
        overlap: overlap,
        scale_factor: scaleFactor,
      };
      if (!returnBase64) args.output_path = outputPath;
      const result = await this.runPythonScript('gaussian_blending.py', args);
      const parsed = JSON.parse(result[0]);
      if (parsed.error) throw new Error(parsed.error);
      return {
        imageData: parsed.image_data,
        outputPath: parsed.saved || outputPath,
        width: parsed.width || totalWidth * scaleFactor,
        height: parsed.height || totalHeight * scaleFactor,
        usedWorker: false,
      };
    } finally {
      try { unlinkSync(tilesJsonPath); } catch (_) { /* ignore */ }
    }
  }

  async generateWeightMap(tileSize: number, overlap: number): Promise<string> {
    try {
      const payload: GenerateWeightPayload = { tileSize, overlap };
      const result = await this.workerPool.submit<any>('generate_weight_map', payload);
      return result.weight_b64;
    } catch (err) {
      this.logger.warn(`Worker 生成权重失败，fallback Python: ${(err as Error).message}`);
      const result = await this.runPythonScript('gaussian_blending.py', {
        action: 'demo_weight',
        tile_size: tileSize,
        overlap,
      });
      const parsed = JSON.parse(result[0]);
      return parsed.weight_b64;
    }
  }

  private async runPythonScript(
    scriptName: string,
    args: Record<string, any>,
  ): Promise<string[]> {
    const options: PythonShell.Options = {
      mode: 'text',
      pythonPath: process.env.PYTHON_PATH || 'python',
      scriptPath: this.pythonScriptDir,
      args: Object.entries(args).map(([k, v]) => `--${k}=${v}`),
    };
    try {
      return await PythonShell.run(scriptName, options);
    } catch (error) {
      this.logger.error(`Python 脚本执行失败: ${scriptName}`, (error as Error).stack);
      throw error;
    }
  }
}
