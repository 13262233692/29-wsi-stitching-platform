import { io, Socket } from 'socket.io-client';
import { ref } from 'vue';
import type { TaskStatus } from '@/types';

export interface WsTilePayload {
  taskId: string;
  row: number;
  col: number;
  imageData: string;
  timestamp: number;
}

export interface WsProgressPayload {
  taskId: string;
  progress: number;
  message?: string;
  timestamp: number;
}

export interface WsStatusPayload extends Partial<TaskStatus> {
  taskId: string;
  timestamp: number;
}

export interface WsCompletePayload {
  taskId: string;
  outputPath: string;
  thumbnail?: string;
  timestamp: number;
}

class WsiWebSocketClient {
  private socket: Socket | null = null;
  connected = ref(false);
  clientId = ref<string>('');

  connect() {
    if (this.socket?.connected) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => {
      this.connected.value = true;
    });
    this.socket.on('disconnect', () => {
      this.connected.value = false;
    });
    this.socket.on('connected', (payload: { clientId: string }) => {
      this.clientId.value = payload.clientId;
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.value = false;
  }

  subscribeTask(taskId: string) {
    this.socket?.emit('subscribe_task', { taskId });
  }

  on(event: 'task_status', handler: (p: WsStatusPayload) => void): void;
  on(event: 'task_tile', handler: (p: WsTilePayload) => void): void;
  on(event: 'task_progress', handler: (p: WsProgressPayload) => void): void;
  on(event: 'task_complete', handler: (p: WsCompletePayload) => void): void;
  on(event: 'task_error', handler: (p: { taskId: string; error: string }) => void): void;
  on(event: 'ome_header', handler: (p: any) => void): void;
  on(event: string, handler: (...args: any[]) => void) {
    this.socket?.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void) {
    this.socket?.off(event, handler);
  }
}

export const wsClient = new WsiWebSocketClient();
