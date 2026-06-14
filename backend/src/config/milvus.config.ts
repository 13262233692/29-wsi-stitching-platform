import { registerAs } from '@nestjs/config';

export default registerAs('milvus', () => ({
  host: process.env.MILVUS_HOST || 'localhost',
  port: parseInt(process.env.MILVUS_PORT || '19530', 10),
  username: process.env.MILVUS_USER || '',
  password: process.env.MILVUS_PASSWORD || '',
  collectionName: process.env.MILVUS_COLLECTION || 'wsi_nucleus_features',
  vectorDim: parseInt(process.env.MILVUS_VECTOR_DIM || '128', 10),
  indexType: (process.env.MILVUS_INDEX_TYPE as any) || 'HNSW',
  metricType: (process.env.MILVUS_METRIC || 'COSINE') as any,
  token: process.env.MILVUS_TOKEN || '',
}));
