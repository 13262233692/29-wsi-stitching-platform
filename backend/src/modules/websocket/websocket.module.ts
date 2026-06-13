import { Module } from '@nestjs/common';
import { WsiStreamingGateway } from './wsi-streaming.gateway';

@Module({
  providers: [WsiStreamingGateway],
  exports: [WsiStreamingGateway],
})
export class WebsocketModule {}
