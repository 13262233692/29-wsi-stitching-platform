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

// ---------- 细胞形态学分析 API ----------
export function getCellAnalysisStatus() {
  return request.get<any, {
    milvus: {
      available: boolean;
      host: string;
      collectionName: string;
      vectorDim: number;
    };
  }>('/cell-analysis/status');
}

export function listAbnormalCells(taskId: string, limit = 500) {
  return request.get<any, { total: number; items: NucleusAbnormalCell[] }>(
    `/cell-analysis/tasks/${taskId}/abnormal`,
    { params: { limit } },
  );
}

export function searchSimilarCells(
  taskId: string,
  vector: number[],
  options?: { topK?: number; global?: boolean },
) {
  return request.post<any, { results: (NucleusAbnormalCell & { distance: number })[] }>(
    `/cell-analysis/tasks/${taskId}/search-similar`,
    { vector, topK: options?.topK || 20, global: options?.global || false },
  );
}

export function analyzeSingleTile(payload: {
  imageData: string;
  tileRow?: number;
  tileCol?: number;
  tileSize?: number;
  overlap?: number;
  scaleFactor?: number;
}) {
  return request.post<any, NucleusAnalysisWorkerResponse>(
    '/cell-analysis/analyze',
    payload,
  );
}

