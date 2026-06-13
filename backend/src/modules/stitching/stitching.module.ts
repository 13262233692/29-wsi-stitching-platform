import { Module } from '@nestjs/common';
import { StitchingService } from './stitching.service';

@Module({
  providers: [StitchingService],
  exports: [StitchingService],
})
export class StitchingModule {}
