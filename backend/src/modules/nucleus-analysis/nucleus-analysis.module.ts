import { Module } from '@nestjs/common';
import { NucleusAnalysisService } from './nucleus-analysis.service';
import { NucleusAnalysisController } from './nucleus-analysis.controller';

@Module({
  controllers: [NucleusAnalysisController],
  providers: [NucleusAnalysisService],
  exports: [NucleusAnalysisService],
})
export class NucleusAnalysisModule {}
