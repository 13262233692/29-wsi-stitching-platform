import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MilvusConfig, NucleusMilvusRecord } from './milvus.types';

@Injectable()
export class MilvusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MilvusService.name);
  private config: MilvusConfig;
  private client: any = null;
  private initialized = false;
  private available = false;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<MilvusConfig>('milvus')!;
  }

  async onModuleInit() {
    try {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      const address = `${this.config.host}:${this.config.port}`;
      this.logger.log(`正在连接 Milvus: ${address}, collection=${this.config.collectionName}`);
      this.client = new MilvusClient({
        address,
        username: this.config.username || undefined,
        password: this.config.password || undefined,
        token: (this.config as any).token || undefined,
      });
      await this.ensureCollection();
      this.available = true;
      this.initialized = true;
      this.logger.log(`Milvus 已就绪: collection=${this.config.collectionName}, dim=${this.config.vectorDim}`);
    } catch (err) {
      this.available = false;
      this.logger.warn(
        `Milvus 连接失败，特征将本地持久化（可用 JSONL fallback）。错误: ${(err as Error).message}`,
      );
    }
  }

  onModuleDestroy() {
    try {
      this.client?.closeConnection?.();
    } catch (_) { /* ignore */ }
  }

  isAvailable(): boolean {
    return this.available && !!this.client;
  }

  private async ensureCollection() {
    if (!this.client) return;
    try {
      const exists = await this.client.hasCollection({
        collection_name: this.config.collectionName,
      });
      if (!exists.value) {
        this.logger.log(`Milvus 集合不存在，自动创建: ${this.config.collectionName}`);
        await this.client.createCollection({
          collection_name: this.config.collectionName,
          fields: [
            { name: 'id', data_type: 'VarChar', is_primary_key: true, max_length: 64 },
            { name: 'vector', data_type: 'FloatVector', dim: this.config.vectorDim },
            { name: 'task_id', data_type: 'VarChar', max_length: 64 },
            { name: 'slide_path', data_type: 'VarChar', max_length: 1024 },
            { name: 'centroid_x', data_type: 'Float' },
            { name: 'centroid_y', data_type: 'Float' },
            { name: 'bbox_x', data_type: 'Int32' },
            { name: 'bbox_y', data_type: 'Int32' },
            { name: 'bbox_w', data_type: 'Int32' },
            { name: 'bbox_h', data_type: 'Int32' },
            { name: 'area', data_type: 'Float' },
            { name: 'circularity', data_type: 'Float' },
            { name: 'aspect_ratio', data_type: 'Float' },
            { name: 'solidity', data_type: 'Float' },
            { name: 'roughness', data_type: 'Float' },
            { name: 'mean_intensity', data_type: 'Float' },
            { name: 'is_abnormal', data_type: 'Bool' },
            { name: 'abnormal_reasons', data_type: 'VarChar', max_length: 256 },
            { name: 'tile_row', data_type: 'Int32' },
            { name: 'tile_col', data_type: 'Int32' },
            { name: 'created_at', data_type: 'Int64' },
          ],
        });
        await this.client.createIndex({
          collection_name: this.config.collectionName,
          field_name: 'vector',
          index_type: this.config.indexType,
          metric_type: this.config.metricType,
          params: this.config.indexType === 'HNSW'
            ? { M: 16, efConstruction: 256 }
            : { nlist: 1024 },
        });
        await this.client.loadCollection({ collection_name: this.config.collectionName });
        this.logger.log(`Milvus 集合创建完成并已加载索引`);
      }
    } catch (err) {
      this.logger.error(`Milvus 集合初始化失败: ${(err as Error).message}`);
      this.available = false;
    }
  }

  async insert(records: NucleusMilvusRecord[]): Promise<{ inserted: number; failed: number }> {
    if (!records.length) return { inserted: 0, failed: 0 };
    if (!this.isAvailable()) {
      return this.localFallback(records);
    }
    try {
      const batch = records.map((r) => ({ ...r, abnormal_reasons: JSON.stringify(r.abnormal_reasons) }));
      const resp = await this.client.insert({
        collection_name: this.config.collectionName,
        data: batch as any,
      });
      const inserted = resp.status?.error_code === 'Success' || resp.insert_cnt ? (resp.insert_cnt || records.length) : 0;
      return { inserted, failed: records.length - inserted };
    } catch (err) {
      this.logger.warn(`Milvus 写入失败，写入本地 fallback: ${(err as Error).message}`);
      return this.localFallback(records);
    }
  }

  private localFallback(records: NucleusMilvusRecord[]): { inserted: number; failed: number } {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(process.cwd(), 'data', 'milvus-fallback');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `nuclei-${Date.now()}.jsonl`);
      const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.appendFileSync(file, lines, 'utf8');
      return { inserted: records.length, failed: 0 };
    } catch (err) {
      this.logger.error(`Milvus fallback 也失败: ${(err as Error).message}`);
      return { inserted: 0, failed: records.length };
    }
  }

  async searchByVector(
    vector: number[],
    opts: { topK?: number; taskId?: string; onlyAbnormal?: boolean } = {},
  ): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const filter: string[] = [];
      if (opts.taskId) filter.push(`task_id == "${opts.taskId}"`);
      if (opts.onlyAbnormal) filter.push('is_abnormal == true');
      const resp = await this.client.search({
        collection_name: this.config.collectionName,
        data: [vector],
        limit: opts.topK || 20,
        output_fields: ['*'],
        filter: filter.length ? filter.join(' && ') : undefined,
      });
      const results = resp.results || [];
      return results.map((r: any) => {
        try { r.abnormal_reasons = JSON.parse(r.abnormal_reasons); } catch (_) { /* ignore */ }
        return r;
      });
    } catch (err) {
      this.logger.warn(`Milvus 搜索失败: ${(err as Error).message}`);
      return [];
    }
  }

  async listAbnormalByTask(taskId: string, limit = 500): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const resp = await this.client.query({
        collection_name: this.config.collectionName,
        filter: `task_id == "${taskId}" && is_abnormal == true`,
        output_fields: ['*'],
        limit,
      });
      const rows = resp.data || [];
      return rows.map((r: any) => {
        try { r.abnormal_reasons = JSON.parse(r.abnormal_reasons); } catch (_) { /* ignore */ }
        return r;
      });
    } catch (err) {
      this.logger.warn(`Milvus query 失败: ${(err as Error).message}`);
      return [];
    }
  }

  getStats() {
    return {
      available: this.available,
      host: this.config.host,
      port: this.config.port,
      collectionName: this.config.collectionName,
      vectorDim: this.config.vectorDim,
      metric: this.config.metricType,
    };
  }
}
