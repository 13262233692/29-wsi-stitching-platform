import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PythonShell } from 'python-shell';
import { join } from 'path';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, writeFileSync } from 'fs';

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
}

@Injectable()
export class StitchingService implements OnModuleInit {
  private readonly logger = new Logger(StitchingService.name);
  private pythonScriptDir: string;
  private outputDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.pythonScriptDir = join(process.cwd(), '..', 'python-service', 'src', 'blending');
    this.outputDir = join(process.cwd(), 'data', 'output');
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    this.logger.log(`拼接输出目录: ${this.outputDir}`);
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
    } = {},
  ): Promise<BlendResult> {
    const tileSize = options.tileSize ?? this.configService.get('wsi.tileSize', 512);
    const overlap = options.overlap ?? this.configService.get('wsi.overlap', 32);
    const scaleFactor = options.scaleFactor ?? this.configService.get('triton.scaleFactor', 4);
    const outputFileName = options.outputFileName ?? `stitched-${Date.now()}.png`;
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
      if (!options.returnBase64) {
        args.output_path = outputPath;
      }

      const result = await this.runPythonScript('gaussian_blending.py', args);
      const parsed = JSON.parse(result[0]);
      if (parsed.error) throw new Error(parsed.error);

      return {
        imageData: parsed.image_data,
        outputPath: parsed.saved || outputPath,
        width: parsed.width || totalWidth * scaleFactor,
        height: parsed.height || totalHeight * scaleFactor,
      };
    } finally {
      try { unlinkSync(tilesJsonPath); } catch (_) { /* ignore */ }
    }
  }

  async generateWeightMap(tileSize: number, overlap: number): Promise<string> {
    const result = await this.runPythonScript('gaussian_blending.py', {
      action: 'demo_weight',
      tile_size: tileSize,
      overlap: overlap,
    });
    const parsed = JSON.parse(result[0]);
    return parsed.weight_b64;
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
      this.logger.error(`Python 脚本执行失败: ${scriptName}`, error.stack);
      throw error;
    }
  }
}
