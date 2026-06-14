import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WsiReaderModule } from './modules/wsi-reader/wsi-reader.module';
import { TritonClientModule } from './modules/triton-client/triton-client.module';
import { StitchingModule } from './modules/stitching/stitching.module';
import { OmeTiffModule } from './modules/ome-tiff/ome-tiff.module';
import { StreamingModule } from './modules/streaming/streaming.module';
import { TaskManagementModule } from './modules/task-management/task-management.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { WorkerPoolModule } from './modules/worker-pool/worker-pool.module';
import { wsiConfig, tritonConfig, streamingConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [wsiConfig, tritonConfig, streamingConfig],
      envFilePath: ['.env', '.env.development'],
    }),
    ScheduleModule.forRoot(),
    WorkerPoolModule,
    WsiReaderModule,
    TritonClientModule,
    StitchingModule,
    OmeTiffModule,
    StreamingModule,
    TaskManagementModule,
    WebsocketModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
