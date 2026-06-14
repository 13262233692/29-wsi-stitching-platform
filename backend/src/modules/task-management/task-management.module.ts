import { Module } from '@nestjs/common';
import { TaskManagementService } from './task-management.service';
import { TaskManagementController } from './task-management.controller';
import { WsiReaderModule } from '../wsi-reader/wsi-reader.module';
import { TritonClientModule } from '../triton-client/triton-client.module';
import { StitchingModule } from '../stitching/stitching.module';
import { OmeTiffModule } from '../ome-tiff/ome-tiff.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { CellAnalysisModule } from '../cell-analysis/cell-analysis.module';

@Module({
  imports: [
    WsiReaderModule,
    TritonClientModule,
    StitchingModule,
    OmeTiffModule,
    WebsocketModule,
    CellAnalysisModule,
  ],
  controllers: [TaskManagementController],
  providers: [TaskManagementService],
  exports: [TaskManagementService],
})
export class TaskManagementModule {}
