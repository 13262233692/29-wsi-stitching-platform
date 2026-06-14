import { Module } from '@nestjs/common';
import { CellAnalysisService } from './cell-analysis.service';
import { CellAnalysisController } from './cell-analysis.controller';

@Module({
  imports: [],
  controllers: [CellAnalysisController],
  providers: [CellAnalysisService],
  exports: [CellAnalysisService],
})
export class CellAnalysisModule {}
