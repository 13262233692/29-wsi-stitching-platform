import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { cpus } from 'os';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  WorkerTask,
  WorkerTaskKind,
  WorkerTaskResult,
} from './worker-pool.types';

interface PendingTask {
  id: string;
  kind: WorkerTaskKind;
  payload: any;
  resolve: (r: any) => void;
  reject: (e: Error) => void;
  createdAt: number;
  timeoutMs: number;
  timer?: NodeJS.Timeout;
}

interface WorkerWrapper {
  worker: Worker;
  id: number;
  currentTaskId: string | null;
  busy: boolean;
  tasksCompleted: number;
  lastActiveAt: number;
}

@Injectable()
export class WorkerPoolService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerPoolService.name);
  private workers: WorkerWrapper[] = [];
  private queue: PendingTask[] = [];
  private activeTasks = new Map<string, PendingTask>();
  private workerScriptPath: string;
  private maxSize: number;
  private defaultTimeoutMs: number;
  private maxQueueSize: number;
  private eventLoopMonitorTimer: NodeJS.Timeout | null = null;
  public readonly events = new EventEmitter();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.maxSize =
      this.configService.get<number>('WORKER_POOL_SIZE') ||
      Math.max(2, Math.min(cpus().length - 1, 8));
    this.defaultTimeoutMs =
      this.configService.get<number>('WORKER_TASK_TIMEOUT_MS') || 120_000;
    this.maxQueueSize =
      this.configService.get<number>('WORKER_MAX_QUEUE') || 64;

    this.workerScriptPath = join(
      __dirname,
      'stitching.worker.js',
    );

    this.logger.log(
      `初始化 Worker 线程池: size=${this.maxSize}, timeout=${this.defaultTimeoutMs}ms, queue=${this.maxQueueSize}, script=${this.workerScriptPath}`,
    );

    for (let i = 0; i < this.maxSize; i++) {
      this.spawnWorker(i);
    }

    this.startEventLoopMonitor();
  }

  onModuleDestroy() {
    this.logger.warn('关闭 Worker 线程池...');
    if (this.eventLoopMonitorTimer) {
      clearInterval(this.eventLoopMonitorTimer);
      this.eventLoopMonitorTimer = null;
    }
    for (const w of this.workers) {
      try { w.worker.terminate(); } catch (_) { /* ignore */ }
    }
    this.workers = [];
    for (const t of this.activeTasks.values()) {
      if (t.timer) clearTimeout(t.timer);
      t.reject(new Error('WorkerPool shutting down'));
    }
    this.activeTasks.clear();
    this.queue = [];
  }

  private spawnWorker(id: number) {
    let worker: Worker;
    try {
      worker = new Worker(this.workerScriptPath);
    } catch (err) {
      this.logger.error(
        `Worker ${id} 启动失败，尝试使用 ts-node 模式或已编译 JS。路径: ${this.workerScriptPath}`,
        (err as Error).stack,
      );
      throw err;
    }

    const wrapper: WorkerWrapper = {
      worker,
      id,
      currentTaskId: null,
      busy: false,
      tasksCompleted: 0,
      lastActiveAt: Date.now(),
    };

    worker.on('message', (msg: WorkerTaskResult & { _ready?: boolean }) => {
      if (msg._ready) {
        this.logger.debug(`Worker ${id} 就绪`);
        this.dispatch();
        return;
      }
      this.onWorkerMessage(wrapper, msg);
    });

    worker.on('error', (err) => {
      this.logger.error(`Worker ${id} 异常: ${err.message}`, err.stack);
    });

    worker.on('exit', (code) => {
      this.logger.warn(`Worker ${id} 退出, code=${code}，正在重启`);
      if (wrapper.currentTaskId) {
        const task = this.activeTasks.get(wrapper.currentTaskId);
        if (task) {
          if (task.timer) clearTimeout(task.timer);
          this.activeTasks.delete(wrapper.currentTaskId);
          task.reject(new Error(`Worker exited with code ${code}`));
        }
      }
      wrapper.busy = false;
      wrapper.currentTaskId = null;
      this.workers = this.workers.filter((w) => w.id !== id);
      setImmediate(() => this.spawnWorker(id));
    });

    this.workers.push(wrapper);
  }

  private onWorkerMessage(wrapper: WorkerWrapper, msg: WorkerTaskResult) {
    wrapper.busy = false;
    wrapper.currentTaskId = null;
    wrapper.tasksCompleted++;
    wrapper.lastActiveAt = Date.now();

    const task = this.activeTasks.get(msg.taskId);
    if (!task) {
      this.logger.warn(`收到未知任务结果: ${msg.taskId}`);
      this.dispatch();
      return;
    }
    if (task.timer) clearTimeout(task.timer);
    this.activeTasks.delete(msg.taskId);

    if (msg.success) {
      task.resolve(msg.data);
    } else {
      task.reject(new Error(msg.error || 'Worker task failed'));
    }
    this.dispatch();
  }

  private dispatch() {
    while (this.queue.length > 0) {
      const free = this.workers.find((w) => !w.busy);
      if (!free) break;
      const task = this.queue.shift()!;
      this.runOnWorker(free, task);
    }
  }

  private runOnWorker(worker: WorkerWrapper, task: PendingTask) {
    worker.busy = true;
    worker.currentTaskId = task.id;
    this.activeTasks.set(task.id, task);

    task.timer = setTimeout(() => {
      if (this.activeTasks.has(task.id)) {
        this.activeTasks.delete(task.id);
        this.logger.warn(
          `Worker 任务超时: kind=${task.kind}, id=${task.id}, elapsed=${Date.now() - task.createdAt}ms`,
        );
        worker.busy = false;
        worker.currentTaskId = null;
        try { worker.worker.terminate(); } catch (_) { /* ignore */ }
        task.reject(new Error(`Worker task timeout after ${task.timeoutMs}ms`));
      }
    }, task.timeoutMs);

    const msg: WorkerTask = {
      id: task.id,
      kind: task.kind,
      payload: task.payload,
    };

    try {
      worker.worker.postMessage(msg);
    } catch (err) {
      if (task.timer) clearTimeout(task.timer);
      this.activeTasks.delete(task.id);
      worker.busy = false;
      worker.currentTaskId = null;
      task.reject(err as Error);
    }
  }

  submit<T = any>(
    kind: WorkerTaskKind,
    payload: any,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new Error(
          `Worker 队列已满 (${this.queue.length}/${this.maxQueueSize})，请稍后重试`,
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const task: PendingTask = {
        id: uuidv4(),
        kind,
        payload,
        resolve,
        reject,
        createdAt: Date.now(),
        timeoutMs,
      };
      this.queue.push(task);
      this.events.emit('queued', task.kind, this.queue.length, this.activeTasks.size);
      setImmediate(() => this.dispatch());
    });
  }

  stats() {
    return {
      poolSize: this.workers.length,
      active: this.activeTasks.size,
      queueDepth: this.queue.length,
      workers: this.workers.map((w) => ({
        id: w.id,
        busy: w.busy,
        currentTaskId: w.currentTaskId,
        tasksCompleted: w.tasksCompleted,
        lastActiveAgo: Date.now() - w.lastActiveAt,
      })),
    };
  }

  private startEventLoopMonitor() {
    let last = process.hrtime.bigint();
    let maxLatencyMs = 0;
    let samples = 0;
    let sum = 0;

    this.eventLoopMonitorTimer = setInterval(() => {
      const now = process.hrtime.bigint();
      const deltaMs = Number(now - last) / 1_000_000 - 100;
      if (deltaMs > maxLatencyMs) maxLatencyMs = deltaMs;
      sum += deltaMs;
      samples++;
      last = now;

      if (deltaMs > 50) {
        this.logger.warn(
          `Event Loop 阻塞警告: 延迟=${deltaMs.toFixed(1)}ms, pool=${this.stats().active}/${this.maxSize}, queue=${this.queue.length}`,
        );
        this.events.emit('event_loop_blocked', deltaMs);
      }

      if (samples >= 60) {
        const avg = sum / samples;
        if (avg > 20 || maxLatencyMs > 100) {
          this.logger.warn(
            `过去 60s Event Loop: avg=${avg.toFixed(1)}ms, max=${maxLatencyMs.toFixed(1)}ms`,
          );
        }
        this.events.emit('event_loop_stats', { avgMs: avg, maxMs: maxLatencyMs, samples });
        maxLatencyMs = 0;
        samples = 0;
        sum = 0;
      }
    }, 100).unref();
  }
}
