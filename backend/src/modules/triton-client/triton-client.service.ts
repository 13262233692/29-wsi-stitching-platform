import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PythonShell } from 'python-shell';
import { join } from 'path';
import {
  SuperResolutionRequestDto,
  SuperResolutionResponseDto,
  BatchSuperResolutionDto,
} from './dto/triton-client.dto';

export interface SrTile {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData: string;
}

@Injectable()
export class TritonClientService implements OnModuleInit {
  private readonly logger = new Logger(TritonClientService.name);
  private pythonScriptDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.pythonScriptDir = join(process.cwd(), '..', 'python-service', 'src', 'triton_client');
    this.logger.log(`Triton 客户端 Python 脚本目录: ${this.pythonScriptDir}`);
  }

  async checkServerStatus(): Promise<{ serverLive: boolean; modelReady: boolean }> {
    try {
      const result = await this.runPythonScript('triton_client.py', {
        action: 'status',
        host: this.configService.get('triton.host'),
        port: this.configService.get('triton.port'),
        model_name: this.configService.get('triton.modelName'),
        model_version: this.configService.get('triton.modelVersion'),
      });
      const parsed = JSON.parse(result[0]);
      return {
        serverLive: !!parsed.server_live,
        modelReady: !!parsed.model_ready,
      };
    } catch (e) {
      this.logger.warn('Triton 服务状态检查失败，将使用 fallback 模式');
      return { serverLive: false, modelReady: false };
    }
  }

  async superResolve(
    request: SuperResolutionRequestDto,
  ): Promise<SuperResolutionResponseDto> {
    const result = await this.runPythonScript('triton_client.py', {
      action: 'single',
      image_data: request.imageData,
      host: this.configService.get('triton.host'),
      port: this.configService.get('triton.port'),
      model_name: request.modelName || this.configService.get('triton.modelName'),
      model_version: this.configService.get('triton.modelVersion'),
      scale_factor: request.scaleFactor || this.configService.get('triton.scaleFactor', 4),
    });

    const parsed = JSON.parse(result[0]);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return {
      imageData: parsed.image_data,
      width: parsed.width,
      height: parsed.height,
      scaleFactor: parsed.scale_factor,
    };
  }

  async superResolveBatch(request: BatchSuperResolutionDto): Promise<SrTile[]> {
    const tmpFile = join(process.cwd(), 'data', `tiles-${Date.now()}.json`);
    const fs = await import('fs');
    const tilesForPy = request.tiles.map((t) => ({
      row: t.row,
      col: t.col,
      x: t.x,
      y: t.y,
      image_data: t.imageData,
    }));
    fs.writeFileSync(tmpFile, JSON.stringify(tilesForPy));

    try {
      const result = await this.runPythonScript('triton_client.py', {
        action: 'batch',
        tiles_json: tmpFile,
        host: this.configService.get('triton.host'),
        port: this.configService.get('triton.port'),
        model_name: this.configService.get('triton.modelName'),
        model_version: this.configService.get('triton.modelVersion'),
        scale_factor: this.configService.get('triton.scaleFactor', 4),
      });
      const parsed = JSON.parse(result[0]);
      if (parsed.error) throw new Error(parsed.error);
      return parsed.tiles.map((t: any) => ({
        row: t.row,
        col: t.col,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        imageData: t.image_data,
      }));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
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
      this.logger.error(`Python 脚本执行失败: ${scriptName}`, error.stack);
      throw error;
    }
  }
}
