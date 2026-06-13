import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PythonShell } from 'python-shell';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  SlideInfoDto,
  TileRequestDto,
  TileBatchRequestDto,
  TileInfoDto,
} from './dto/wsi-reader.dto';

@Injectable()
export class WsiReaderService implements OnModuleInit {
  private readonly logger = new Logger(WsiReaderService.name);
  private pythonScriptDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.pythonScriptDir = join(
      process.cwd(),
      '..',
      'python-service',
      'src',
    );
    this.logger.log(`Python 脚本目录: ${this.pythonScriptDir}`);
  }

  async getSlideInfo(filePath: string, level?: number): Promise<SlideInfoDto> {
    this.logger.log(`获取 WSI 信息: ${filePath}`);

    const result = await this.runPythonScript('wsi_reader.py', {
      action: 'info',
      file_path: filePath,
      level: level ?? 0,
    });

    return JSON.parse(result[0]);
  }

  async readTile(request: TileRequestDto): Promise<TileInfoDto> {
    this.logger.debug(
      `读取切片: x=${request.x}, y=${request.y}, size=${request.width}x${request.height}`,
    );

    const result = await this.runPythonScript('wsi_reader.py', {
      action: 'tile',
      file_path: request.filePath,
      level: request.level ?? 0,
      x: request.x,
      y: request.y,
      width: request.width,
      height: request.height,
    });

    const parsed = JSON.parse(result[0]);
    return {
      row: 0,
      col: 0,
      x: request.x,
      y: request.y,
      width: request.width,
      height: request.height,
      imageData: parsed.image_data,
    };
  }

  async readTilesBatch(request: TileBatchRequestDto): Promise<{
    tiles: TileInfoDto[];
    gridRows: number;
    gridCols: number;
    totalWidth: number;
    totalHeight: number;
  }> {
    this.logger.log(
      `批量读取切片: tileSize=${request.tileSize}, overlap=${request.overlap}`,
    );

    const result = await this.runPythonScript('wsi_reader.py', {
      action: 'batch_tiles',
      file_path: request.filePath,
      level: request.level ?? 0,
      tile_size: request.tileSize,
      overlap: request.overlap,
    });

    const parsed = JSON.parse(result[0]);
    return {
      tiles: parsed.tiles.map((t: any) => ({
        row: t.row,
        col: t.col,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        imageData: t.image_data,
      })),
      gridRows: parsed.grid_rows,
      gridCols: parsed.grid_cols,
      totalWidth: parsed.total_width,
      totalHeight: parsed.total_height,
    };
  }

  async readTilesGenerator(
    request: TileBatchRequestDto,
    onTile: (tile: TileInfoDto, progress: number) => void | Promise<void>,
  ): Promise<{ gridRows: number; gridCols: number; totalWidth: number; totalHeight: number }> {
    const slideInfo = await this.getSlideInfo(request.filePath, request.level);
    const targetLevel = slideInfo.levels[request.level ?? 0];
    const { tileSize, overlap } = request;

    const effectiveStep = tileSize - overlap;
    const gridCols = Math.ceil((targetLevel.width - overlap) / effectiveStep);
    const gridRows = Math.ceil((targetLevel.height - overlap) / effectiveStep);

    this.logger.log(
      `切片网格: ${gridRows} x ${gridCols}, 总切片数: ${gridRows * gridCols}`,
    );

    const totalTiles = gridRows * gridCols;
    let processed = 0;

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const x = col * effectiveStep;
        const y = row * effectiveStep;
        const actualWidth = Math.min(tileSize, targetLevel.width - x);
        const actualHeight = Math.min(tileSize, targetLevel.height - y);

        const tile = await this.readTile({
          filePath: request.filePath,
          level: request.level ?? 0,
          x,
          y,
          width: actualWidth,
          height: actualHeight,
        });
        tile.row = row;
        tile.col = col;

        processed++;
        const progress = (processed / totalTiles) * 100;
        await onTile(tile, progress);
      }
    }

    return {
      gridRows,
      gridCols,
      totalWidth: targetLevel.width,
      totalHeight: targetLevel.height,
    };
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
