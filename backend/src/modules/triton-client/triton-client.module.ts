import { Module } from '@nestjs/common';
import { TritonClientService } from './triton-client.service';
import { TritonClientController } from './triton-client.controller';

@Module({
  controllers: [TritonClientController],
  providers: [TritonClientService],
  exports: [TritonClientService],
})
export class TritonClientModule {}
