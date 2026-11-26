export type AppView = 'home' | 'downloads' | 'settings';

export type TaskStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'completed'
  | 'failed';

export interface VideoPage {
  cid: number;
  index: number;
  title: string;
  duration: number;
}

export interface VideoInfo {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  cover: string;
  owner: string;
  duration: number;
  viewCount: number;
  publishedAt: number;
  pages: VideoPage[];
}

export interface QualityOption {
  id: number;
  label: string;
  /** 实际流宽度，0 表示未知（durl / MP4） */
  width?: number;
  /** 实际流高度，0 表示未知 */
  height?: number;
}

export interface SubtitleOption {
  lan: string;
  label: string;
  url: string;
}

export interface SubtitleCue {
  from: number;
  to: number;
  text: string;
}

export interface DownloadRequest {
  video: VideoInfo;
  pageIds: number[];
  quality: number;
  qualityLabel: string;
  audioOnly: boolean;
  outputDir: string;
  /** 下载视频时附带封面图、NFO 元数据、字幕与弹幕 */
  withExtras?: boolean;
  subtitleLan?: string;
  withDanmaku?: boolean;
}

export interface DownloadTask {
  id: string;
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pageTitle: string;
  owner: string;
  cover: string;
  quality: number;
  qualityLabel: string;
  audioOnly: boolean;
  status: TaskStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  outputDir: string;
  outputPath: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  withExtras?: boolean;
  subtitleLan?: string;
  withDanmaku?: boolean;
  extras?: string[];
  publishedAt?: number;
}

export interface AppSettings {
  downloadDir: string;
  maxConcurrent: number;
  defaultQuality: number;
  fileNameTemplate: string;
  autoStart: boolean;
  notifications: boolean;
  ffmpegPath: string;
  cookie: string;
  /** 下载时默认附带字幕/弹幕/封面/NFO */
  downloadExtras: boolean;
  subtitleLanguage: string;
  downloadDanmaku: boolean;
}

export interface RuntimeInfo {
  platform: string;
  ffmpegAvailable: boolean;
  isDesktop: boolean;
}

export type QrLoginStatus = 'pending' | 'scanned' | 'success' | 'expired';

export interface QrLoginSession {
  url: string;
  qrcodeKey: string;
}

export interface QrLoginResult {
  status: QrLoginStatus;
  message: string;
  cookie?: string;
}

export interface DownKyiApi {
  parseVideo(input: string): Promise<VideoInfo>;
  getQualities(bvid: string, cid: number): Promise<QualityOption[]>;
  getSubtitles(bvid: string, cid: number): Promise<SubtitleOption[]>;
  getDanmaku(cid: number): Promise<string>;
  createDownloads(request: DownloadRequest): Promise<DownloadTask[]>;
  listTasks(): Promise<DownloadTask[]>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  retryTask(id: string): Promise<void>;
  removeTask(id: string, deleteFile?: boolean): Promise<void>;
  clearCompleted(): Promise<void>;
  revealItem(path: string): Promise<void>;
  selectDirectory(): Promise<string | null>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  loginGenerate(): Promise<QrLoginSession>;
  loginPoll(qrcodeKey: string): Promise<QrLoginResult>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  onTasksChanged(callback: (tasks: DownloadTask[]) => void): () => void;
}