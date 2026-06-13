import { Module } from '@nestjs/common';
import { WsiReaderService } from './wsi-reader.service';
import { WsiReaderController } from './wsi-reader.controller';

@Module({
  controllers: [WsiReaderController],
  providers: [WsiReaderService],
  exports: [WsiReaderService],
})
export class WsiReaderModule {}
