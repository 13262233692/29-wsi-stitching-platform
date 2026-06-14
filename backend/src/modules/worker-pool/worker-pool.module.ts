import { Module, Global } from '@nestjs/common';
import { WorkerPoolService } from './worker-pool.service';

@Global()
@Module({
  providers: [WorkerPoolService],
  exports: [WorkerPoolService],
})
export class WorkerPoolModule {}
