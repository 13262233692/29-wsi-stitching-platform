import { Module, Global } from '@nestjs/common';
import { MilvusService } from './milvus.service';

@Global()
@Module({
  providers: [MilvusService],
  exports: [MilvusService],
})
export class MilvusModule {}
