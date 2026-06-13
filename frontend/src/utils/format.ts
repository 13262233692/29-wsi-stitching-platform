import dayjs from 'dayjs';

export function formatTimestamp(ts?: number): string {
  if (!ts) return '-';
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

export function formatDuration(from?: number, to?: number): string {
  if (!from) return '-';
  const end = to || Date.now();
  const diff = Math.max(0, end - from);
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function stateLabel(state: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    reading: '读取图像',
    super_resolving: '超分重构',
    stitching: '图像拼接',
    saving: '保存输出',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return map[state] || state;
}

export function stateColor(state: string): string {
  const map: Record<string, string> = {
    pending: '#909399',
    reading: '#409eff',
    super_resolving: '#e6a23c',
    stitching: '#8e44ad',
    saving: '#16a085',
    completed: '#67c23a',
    failed: '#f56c6c',
    cancelled: '#c0c4cc',
  };
  return map[state] || '#909399';
}
