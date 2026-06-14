import { ConfigModule, ConfigService } from '@nestjs/config';
import wsiConfig from './wsi.config';
import tritonConfig from './triton.config';
import streamingConfig from './streaming.config';
import milvusConfig from './milvus.config';

export { wsiConfig, tritonConfig, streamingConfig, milvusConfig };

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  load: [wsiConfig, tritonConfig, streamingConfig, milvusConfig],
  envFilePath: ['.env', '.env.development'],
});

export default (config: ConfigService): any => ({
  wsi: {
    tileSize: config.get('wsi.tileSize'),
    overlap: config.get('wsi.overlap'),
  },
  triton: {
    host: config.get('triton.host'),
    port: config.get('triton.port'),
    modelName: config.get('triton.modelName'),
  },
  milvus: {
    host: config.get('milvus.host'),
    collectionName: config.get('milvus.collectionName'),
  },
});
