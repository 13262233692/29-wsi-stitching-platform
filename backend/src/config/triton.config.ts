import { registerAs } from '@nestjs/config';

export default registerAs('triton', () => ({
  host: process.env.TRITON_HOST || 'localhost',
  port: parseInt(process.env.TRITON_PORT || '8001', 10),
  httpPort: parseInt(process.env.TRITON_HTTP_PORT || '8000', 10),
  modelName: process.env.TRITON_MODEL_NAME || 'wsi_super_resolution',
  modelVersion: process.env.TRITON_MODEL_VERSION || '1',
  scaleFactor: parseInt(process.env.TRITON_SCALE_FACTOR || '4', 10),
  requestTimeout: parseInt(process.env.TRITON_REQUEST_TIMEOUT || '30000', 10),
  maxConcurrentRequests: parseInt(process.env.TRITON_MAX_CONCURRENT || '8', 10),
}));
