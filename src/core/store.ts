import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings, DownloadTask } from '../shared/types';

const SETTINGS_KEY = 'downkyi.settings';
const TASKS_KEY = 'downkyi.tasks';

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '', // 运行时由 RN 端填充为 Documents/DownKyi
  maxConcurrent: 2,
  defaultQuality: 80,
  fileNameTemplate: '{title} - {part}',
  autoStart: true,
  notifications: true,
  ffmpegPath: '',
  cookie: '',
  downloadExtras: false,
  subtitleLanguage: 'ai-zh',
  downloadDanmaku: false,
};

/** 设置与任务的本地持久化（AsyncStorage 版，替代 Node fs） */
export class AppStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private tasks: DownloadTask[] = [];

  async init(defaultDownloadDir: string): Promise<void> {
    const [rawSettings, rawTasks] = await Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(TASKS_KEY),
    ]);
    if (rawSettings) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings), downloadDir: defaultDownloadDir };
      } catch {
        this.settings = { ...DEFAULT_SETTINGS, downloadDir: defaultDownloadDir };
      }
    } else {
      this.settings = { ...DEFAULT_SETTINGS, downloadDir: defaultDownloadDir };
    }
    if (rawTasks) {
      try {
        this.tasks = JSON.parse(rawTasks) as DownloadTask[];
      } catch {
        this.tasks = [];
      }
    }
    // 应用重启后，未完成的任务统一暂停（与桌面端行为一致）
    let changed = false;
    for (const task of this.tasks) {
      if (task.status === 'downloading' || task.status === 'merging' || task.status === 'queued') {
        task.status = 'paused';
        changed = true;
      }
    }
    if (changed) await this.saveTasks();
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  async saveSettings(value: AppSettings): Promise<void> {
    this.settings = {
      ...value,
      maxConcurrent: Math.max(1, Math.min(5, Math.round(value.maxConcurrent) || 2)),
    };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  getTasks(): DownloadTask[] {
    return this.tasks;
  }

  getTask(id: string): DownloadTask | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  async addTasks(tasks: DownloadTask[]): Promise<void> {
    this.tasks.push(...tasks);
    await this.saveTasks();
  }

  async updateTask(id: string, patch: Partial<DownloadTask>): Promise<void> {
    const task = this.getTask(id);
    if (!task) return;
    Object.assign(task, patch, { updatedAt: Date.now() });
    await this.saveTasks();
  }

  async removeTask(id: string): Promise<void> {
    this.tasks = this.tasks.filter((task) => task.id !== id);
    await this.saveTasks();
  }

  async clearCompleted(): Promise<void> {
    this.tasks = this.tasks.filter((task) => task.status !== 'completed');
    await this.saveTasks();
  }

  async saveTasks(): Promise<void> {
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(this.tasks));
  }
}
