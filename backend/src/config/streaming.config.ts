import { registerAs } from '@nestjs/config';

export default registerAs('streaming', () => ({
  websocketPort: parseInt(process.env.WS_PORT || '3001', 10),
  maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '100', 10),
  chunkSize: parseInt(process.env.STREAM_CHUNK_SIZE || '65536', 10),
  heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10),
}));
