import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkerPoolService } from './modules/worker-pool/worker-pool.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly workerPool: WorkerPoolService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '健康检查' })
  getHealth(): {
    status: string;
    timestamp: string;
    service: string;
    workerPool: ReturnType<WorkerPoolService['stats']>;
    pid: number;
    uptimeSec: number;
  } {
    return {
      ...this.appService.getHealth(),
      workerPool: this.workerPool.stats(),
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
    };
  }

  @Get('worker-pool/stats')
  @ApiOperation({ summary: 'Worker 线程池状态与 Event Loop 监控' })
  getWorkerPoolStats() {
    return {
      ...this.workerPool.stats(),
      memory: process.memoryUsage(),
      uptimeSec: Math.floor(process.uptime()),
    };
  }
}
