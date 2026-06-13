import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TaskStatus } from '../task-management/dto/task-management.dto';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
  pingInterval: 30000,
  pingTimeout: 5000,
})
export class WsiStreamingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(WsiStreamingGateway.name);
  private connectedClients = new Map<string, Socket>();

  afterInit(server: Server) {
    this.logger.log('WebSocket 流式推送网关已初始化');
  }

  handleConnection(client: Socket) {
    this.connectedClients.set(client.id, client);
    this.logger.log(`客户端连接: ${client.id}, 当前连接数: ${this.connectedClients.size}`);
    client.emit('connected', { clientId: client.id, timestamp: Date.now() });
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`客户端断开: ${client.id}, 当前连接数: ${this.connectedClients.size}`);
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.emit('pong', { timestamp: Date.now(), ...data });
  }

  @SubscribeMessage('subscribe_task')
  handleSubscribeTask(
    @MessageBody() data: { taskId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.taskId) {
      client.join(`task:${data.taskId}`);
      this.logger.log(`客户端 ${client.id} 订阅任务: ${data.taskId}`);
      client.emit('subscribed', { taskId: data.taskId });
    }
  }

  broadcastTaskStatus(taskId: string, status: Partial<TaskStatus>) {
    this.server.to(`task:${taskId}`).emit('task_status', {
      taskId,
      ...status,
      timestamp: Date.now(),
    });
  }

  broadcastTaskTile(taskId: string, tile: { row: number; col: number; imageData: string }) {
    this.server.to(`task:${taskId}`).emit('task_tile', {
      taskId,
      ...tile,
      timestamp: Date.now(),
    });
  }

  broadcastTaskProgress(taskId: string, progress: number, message?: string) {
    this.server.to(`task:${taskId}`).emit('task_progress', {
      taskId,
      progress,
      message,
      timestamp: Date.now(),
    });
  }

  broadcastTaskComplete(taskId: string, outputPath: string, thumbnail?: string) {
    this.server.to(`task:${taskId}`).emit('task_complete', {
      taskId,
      outputPath,
      thumbnail,
      timestamp: Date.now(),
    });
  }

  broadcastTaskError(taskId: string, error: string) {
    this.server.to(`task:${taskId}`).emit('task_error', {
      taskId,
      error,
      timestamp: Date.now(),
    });
  }

  broadcastGlobal(event: string, payload: any) {
    this.server.emit(event, { ...payload, timestamp: Date.now() });
  }
}
