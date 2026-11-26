import RNFS from '@dr.pogodin/react-native-fs';
import type {
  AppSettings,
  DownloadRequest,
  DownloadTask,
  DownKyiApi,
  QrLoginResult,
  QrLoginSession,
  RuntimeInfo,
  VideoInfo,
} from '../shared/types';
import { BilibiliClient } from '../core/bilibili';
import { DownloadManager } from '../core/download-manager';
import { checkFfmpeg } from '../core/ffmpeg';
import { BilibiliLogin } from '../core/login';
import { AppStore } from '../core/store';

/** RN 单进程本地 API 实现 DownKyiApi 契约（UI 无需 IPC，直接调用 core） */
export class NativeApi implements DownKyiApi {
  private readonly store = new AppStore();
  private readonly client: BilibiliClient;
  private readonly login = new BilibiliLogin();
  private readonly manager: DownloadManager;
  private readonly listeners = new Set<(tasks: DownloadTask[]) => void>();
  private ffmpegAvailable = false;
  private initialized = false;

  constructor() {
    this.client = new BilibiliClient(() => this.store.getSettings().cookie);
    this.manager = new DownloadManager(this.store, this.client, (tasks) => {
      for (const listener of this.listeners) listener(tasks);
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const defaultDir = `${RNFS.DocumentDirectoryPath}/DownKyi`;
    await RNFS.mkdir(defaultDir);
    await this.store.init(defaultDir);
    try {
      this.ffmpegAvailable = await checkFfmpeg();
    } catch {
      this.ffmpegAvailable = false;
    }
    this.initialized = true;
  }

  private async ensure(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  async parseVideo(input: string): Promise<VideoInfo> {
    await this.ensure();
    return this.client.parseVideo(input);
  }

  async getQualities(bvid: string, cid: number) {
    await this.ensure();
    return this.client.getQualities(bvid, cid);
  }

  async getSubtitles(bvid: string, cid: number) {
    await this.ensure();
    return this.client.getSubtitles(bvid, cid);
  }

  async getDanmaku(cid: number): Promise<string> {
    await this.ensure();
    return this.client.getDanmaku(cid);
  }

  async createDownloads(request: DownloadRequest): Promise<DownloadTask[]> {
    await this.ensure();
    return this.manager.createDownloads(request);
  }

  async listTasks(): Promise<DownloadTask[]> {
    await this.ensure();
    return this.store.getTasks().map((task) => ({ ...task }));
  }

  async pauseTask(id: string): Promise<void> {
    await this.manager.pauseTask(id);
  }

  async resumeTask(id: string): Promise<void> {
    await this.manager.resumeTask(id);
  }

  async retryTask(id: string): Promise<void> {
    await this.manager.retryTask(id);
  }

  async removeTask(id: string, deleteFile = false): Promise<void> {
    const task = this.store.getTask(id);
    await this.manager.removeTask(id);
    if (deleteFile && task) {
      try {
        if (await RNFS.exists(task.outputPath)) await RNFS.unlink(task.outputPath);
      } catch {
        // 文件已不存在或无权限，忽略
      }
    }
  }

  async clearCompleted(): Promise<void> {
    await this.manager.clearCompleted();
  }

  /** 在安卓上用系统分享/文件管理器打开（这里简化为返回路径提示） */
  async revealItem(path: string): Promise<void> {
    // RN 端可通过 Intent 打开；这里保留契约，UI 显示路径供用户查找
    void path;
  }

  async selectDirectory(): Promise<string | null> {
    // 安卓默认下载到 App 专属目录，SAF 目录选择留待后续版本
    return this.store.getSettings().downloadDir || null;
  }

  async getSettings(): Promise<AppSettings> {
    await this.ensure();
    return this.store.getSettings();
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.ensure();
    await this.store.saveSettings(settings);
  }

  async loginGenerate(): Promise<QrLoginSession> {
    return this.login.generate();
  }

  async loginPoll(qrcodeKey: string): Promise<QrLoginResult> {
    return this.login.poll(qrcodeKey);
  }

  async getRuntimeInfo(): Promise<RuntimeInfo> {
    await this.ensure();
    return { platform: 'android', ffmpegAvailable: this.ffmpegAvailable, isDesktop: false };
  }

  onTasksChanged(callback: (tasks: DownloadTask[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

export const nativeApi = new NativeApi();
