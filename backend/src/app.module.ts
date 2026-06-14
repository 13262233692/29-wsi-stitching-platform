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
import { MilvusModule } from './modules/milvus/milvus.module';
import { CellAnalysisModule } from './modules/cell-analysis/cell-analysis.module';
import { wsiConfig, tritonConfig, streamingConfig, milvusConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [wsiConfig, tritonConfig, streamingConfig, milvusConfig],
      envFilePath: ['.env', '.env.development'],
    }),
    ScheduleModule.forRoot(),
    WorkerPoolModule,
    MilvusModule,
    WsiReaderModule,
    TritonClientModule,
    StitchingModule,
    OmeTiffModule,
    StreamingModule,
    WebsocketModule,
    CellAnalysisModule,
    TaskManagementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
