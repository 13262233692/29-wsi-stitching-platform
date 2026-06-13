import { Module } from '@nestjs/common';
import { OmeTiffService } from './ome-tiff.service';

@Module({
  providers: [OmeTiffService],
  exports: [OmeTiffService],
})
export class OmeTiffModule {}
