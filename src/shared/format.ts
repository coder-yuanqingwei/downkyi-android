export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatCompactNumber(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)} 万`;
  return String(value);
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '等待中',
    downloading: '下载中',
    paused: '已暂停',
    merging: '合并中',
    completed: '已完成',
    failed: '失败',
  };
  return labels[status] ?? status;
}