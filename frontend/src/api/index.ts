import request from './request';
import type {
  TaskStatus,
  CreateTaskRequest,
  TaskListResponse,
  TaskState,
  SlideInfo,
  ServerStatus,
} from '@/types';

export function getHealth() {
  return request.get<any, { status: string; timestamp: string; service: string }>('/health');
}

export function createTask(data: CreateTaskRequest) {
  return request.post<any, TaskStatus>('/tasks', data);
}

export function listTasks(params?: { state?: TaskState; offset?: number; limit?: number }) {
  return request.get<any, TaskListResponse>('/tasks', { params });
}

export function getTask(taskId: string) {
  return request.get<any, TaskStatus>(`/tasks/${taskId}`);
}

export function cancelTask(taskId: string) {
  return request.delete<any, TaskStatus>(`/tasks/${taskId}/cancel`);
}

export function getSlideInfo(filePath: string, level?: number) {
  return request.get<any, SlideInfo>('/wsi/info', { params: { filePath, level } });
}

export function uploadWsiFile(file: File, onProgress?: (p: number) => void) {
  const form = new FormData();
  form.append('file', file);
  return request.post<any, { filePath: string; originalName: string; size: number }>(
    '/wsi/upload',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (evt) => {
        if (evt.total && onProgress) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      },
    },
  );
}

export function getTritonStatus() {
  return request.get<any, ServerStatus>('/triton/status');
}

export function downloadTaskResult(taskId: string) {
  window.open(`/api/streaming/${taskId}/download`, '_blank');
}
