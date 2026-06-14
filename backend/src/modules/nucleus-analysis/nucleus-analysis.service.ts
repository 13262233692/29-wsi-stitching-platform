import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PythonShell } from 'python-shell';
import { join } from 'path';
import {
  existsSync, mkdirSync, writeFileSync, unlinkSync,
} from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  AnalyzeTileRequestDto,
  NucleiQueryRequestDto,
  NucleiSearchRequestDto,
} from './dto/nucleus-analysis.dto';

export interface NucleusFeature {
  inst_id: number;
  centroid: number[];
  bbox: number[];
  area: number;
  circularity: number;
  aspect_ratio: number;
  solidity: number;
  boundary_roughness: number;
  ecd: number;
  rectangularity: number;
  fractal_dim: number;
  intensity_std: number;
  abnormality_score: number;
  abnormality_tags: string[];
  sub_scores?: Record<string, number>;
  feature_vector: number[];
}

export interface AnalyzeTileResult {
  task_id: string;
  total_nuclei: number;
  abnormal_count: number;
  milvus_saved: number;
  abnormal: NucleusFeature[];
  all_count: number;
  all: NucleusFeature[];
}

export interface MilvusRecord {
  id: string;
  task_id: string;
  wsi_x: number;
  wsi_y: number;
  wsi_width: number;
  wsi_height: number;
  tile_row: number;
  tile_col: number;
  inst_id: number;
  circularity: number;
  aspect_ratio: number;
  boundary_roughness: number;
  intensity_std: number;
  abnormality_score: number;
  tags: string;
  created_at: number;
  _distance?: number;
  _score?: number;
}

@Injectable()
export class NucleusAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(NucleusAnalysisService.name);
  private pythonScriptDir: string;
  private tmpDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.pythonScriptDir = join(
      process.cwd(),
      '..',
      'python-service',
      'src',
      'nucleus_analysis',
    );
    this.tmpDir = join(process.cwd(), 'data', 'tmp_nucleus');
    if (!existsSync(this.tmpDir)) mkdirSync(this.tmpDir, { recursive: true });
    this.logger.log(
      `NucleusAnalysisService 初始化: python 目录=${this.pythonScriptDir}, tmp=${this.tmpDir}`,
    );
  }

  async analyzeTile(dto: AnalyzeTileRequestDto): Promise<AnalyzeTileResult> {
    const jsonPath = join(this.tmpDir, `${uuidv4()}.json`);
    const payload: Record<string, any> = {
      task_id: dto.taskId,
      tile_row: dto.tileRow,
      tile_col: dto.tileCol,
      tile_global_offset: dto.tileGlobalOffset,
      wsi_width: dto.wsiWidth,
      wsi_height: dto.wsiHeight,
      image_b64: dto.imageB64,
      min_area: dto.minArea ?? 80,
      max_area: dto.maxArea ?? 8000,
      score_threshold: dto.scoreThreshold ?? 0.5,
      skip_milvus: !!dto.skipMilvus,
    };
    writeFileSync(jsonPath, JSON.stringify(payload, null, 0));

    try {
      const t0 = Date.now();
      const out = await this.runPython('pipeline.py', {
        action: 'analyze_tile',
        input_json: jsonPath,
      });
      this.logger.log(
        `tile(${dto.tileRow},${dto.tileCol}) 分析完成: nuclei=${JSON.parse(out[0]).total_nuclei}, abnormal=${JSON.parse(out[0]).abnormal_count}, elapsed=${Date.now() - t0}ms`,
      );
      return JSON.parse(out[0]) as AnalyzeTileResult;
    } finally {
      try { unlinkSync(jsonPath); } catch (_) { /* ignore */ }
    }
  }

  async queryTask(taskId: string, topK = 5000): Promise<MilvusRecord[]> {
    const out = await this.runPython('pipeline.py', {
      action: 'query_task',
      task_id: taskId,
      top_k: topK,
    });
    return (JSON.parse(out[0]) as { items: MilvusRecord[] }).items;
  }

  async searchSimilar(dto: NucleiSearchRequestDto) {
    const jsonPath = join(this.tmpDir, `fv-${uuidv4()}.json`);
    writeFileSync(jsonPath, JSON.stringify({ feature_vector: dto.featureVector }));
    try {
      const out = await this.runPython('pipeline.py', {
        action: 'search_similar',
        feature_json: jsonPath,
        ...(dto.taskId ? { task_id: dto.taskId } : {}),
        top_k: dto.topK ?? 20,
      });
      return JSON.parse(out[0]);
    } finally {
      try { unlinkSync(jsonPath); } catch (_) { /* ignore */ }
    }
  }

  async deleteTask(taskId: string) {
    const out = await this.runPython('pipeline.py', {
      action: 'delete_task',
      task_id: taskId,
    });
    return JSON.parse(out[0]);
  }

  async healthCheck() {
    try {
      const out = await this.runPython('pipeline.py', { action: 'health' });
      return JSON.parse(out[0]);
    } catch (e) {
      this.logger.warn(`Milvus health 失败: ${(e as Error).message}`);
      return { available: false, error: (e as Error).message };
    }
  }

  private async runPython(
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
      this.logger.error(
        `Nucleus Python 脚本执行失败: ${scriptName}, args=${JSON.stringify(args)}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
