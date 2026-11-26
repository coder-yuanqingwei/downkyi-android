import RNFS from '@dr.pogodin/react-native-fs';
import { buildFileName } from '../shared/bilibili';
import type { DownloadRequest, DownloadTask, VideoInfo, VideoPage } from '../shared/types';
import { BilibiliClient, type MediaStream, type PlaySelection } from './bilibili';
import { pickSubtitle, writeExtraFiles } from './extras';
import { mergeMedia } from './ffmpeg';
import { AppStore } from './store';
import { uuid } from '../lib/uuid';

function joinPath(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, '')}/${file}`;
}

/** 下载任务调度核心（RN 版：RNFS 原生下载 + 断点续传 + ffmpeg-kit 合并） */
export class DownloadManager {
  private readonly active = new Set<string>();
  private readonly jobIds = new Map<string, number>();
  private emitTimer = 0;

  constructor(
    private readonly store: AppStore,
    private readonly client: BilibiliClient,
    private readonly onChange: (tasks: DownloadTask[]) => void,
  ) {}

  async createDownloads(request: DownloadRequest): Promise<DownloadTask[]> {
    const settings = this.store.getSettings();
    const selectedPages = request.video.pages.filter((page) => request.pageIds.includes(page.cid));
    if (!selectedPages.length) throw new Error('请至少选择一个视频分集');
    const outputDir = request.outputDir || settings.downloadDir;
    const tasks: DownloadTask[] = [];
    const reused: DownloadTask[] = [];

    for (const page of selectedPages) {
      const duplicate = this.store.getTasks().find(
        (task) =>
          task.bvid === request.video.bvid &&
          task.cid === page.cid &&
          task.quality === request.quality &&
          task.audioOnly === request.audioOnly &&
          !['completed', 'failed'].includes(task.status),
      );
      if (duplicate) {
        if (duplicate.status === 'paused' || duplicate.status === 'queued') reused.push(duplicate);
        continue;
      }
      const extension = request.audioOnly ? 'm4a' : 'mp4';
      const baseName = buildFileName(settings.fileNameTemplate, {
        title: request.video.title,
        part: selectedPages.length > 1 ? `P${page.index} ${page.title}` : page.title,
        owner: request.video.owner,
        bvid: request.video.bvid,
        quality: request.qualityLabel,
      });
      const outputPath = await this.uniqueOutputPath(outputDir, baseName, extension);
      const now = Date.now();
      tasks.push({
        id: uuid(),
        aid: request.video.aid,
        bvid: request.video.bvid,
        cid: page.cid,
        title: request.video.title,
        pageTitle: page.title,
        owner: request.video.owner,
        cover: request.video.cover,
        publishedAt: request.video.publishedAt,
        quality: request.quality,
        qualityLabel: request.qualityLabel,
        audioOnly: request.audioOnly,
        withExtras: request.withExtras ?? settings.downloadExtras,
        subtitleLan: request.subtitleLan ?? settings.subtitleLanguage,
        withDanmaku: request.withDanmaku ?? settings.downloadDanmaku,
        status: settings.autoStart ? 'queued' : 'paused',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        outputDir,
        outputPath,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.store.addTasks(tasks);
    this.emit(true);
    this.pump();
    return [...tasks, ...reused];
  }

  async pauseTask(id: string): Promise<void> {
    const task = this.store.getTask(id);
    if (!task || ['completed', 'failed'].includes(task.status)) return;
    task.status = 'paused';
    task.speed = 0;
    task.updatedAt = Date.now();
    const jobId = this.jobIds.get(id);
    if (jobId != null) RNFS.stopDownload(jobId);
    await this.store.saveTasks();
    this.emit(true);
  }

  async resumeTask(id: string): Promise<void> {
    const task = this.store.getTask(id);
    if (!task || task.status !== 'paused') return;
    task.status = 'queued';
    task.error = undefined;
    task.updatedAt = Date.now();
    await this.store.saveTasks();
    this.emit(true);
    this.pump();
  }

  async retryTask(id: string): Promise<void> {
    const task = this.store.getTask(id);
    if (!task || task.status !== 'failed') return;
    task.status = 'queued';
    task.error = undefined;
    task.progress = 0;
    task.downloadedBytes = 0;
    task.totalBytes = 0;
    task.speed = 0;
    await this.store.saveTasks();
    this.emit(true);
    this.pump();
  }

  async removeTask(id: string): Promise<void> {
    const jobId = this.jobIds.get(id);
    if (jobId != null) RNFS.stopDownload(jobId);
    await this.store.removeTask(id);
    this.emit(true);
  }

  async clearCompleted(): Promise<void> {
    await this.store.clearCompleted();
    this.emit(true);
  }

  shutdown(): void {
    for (const jobId of this.jobIds.values()) RNFS.stopDownload(jobId);
    this.jobIds.clear();
  }

  private pump(): void {
    const limit = this.store.getSettings().maxConcurrent;
    const queued = this.store.getTasks().filter((task) => task.status === 'queued');
    for (const task of queued) {
      if (this.active.size >= limit) break;
      if (this.active.has(task.id)) continue;
      void this.runTask(task.id);
    }
  }

  private async runTask(id: string): Promise<void> {
    const task = this.store.getTask(id);
    if (!task) return;
    this.active.add(id);
    try {
      task.status = 'downloading';
      task.error = undefined;
      task.updatedAt = Date.now();
      await RNFS.mkdir(task.outputDir);
      this.emit(true);

      const video = await this.getVideoInfo(task);
      const page = video.pages.find((item) => item.cid === task.cid);
      if (!page) throw new Error('找不到对应分集');

      const selection = await this.client.selectStreams(task.bvid, task.cid, task.quality, task.audioOnly);
      if (selection.file) {
        await this.downloadStream(task, selection.file, 'single');
        await this.safeMove(await this.partPath(task, 'single'), task.outputPath);
      } else {
        if (selection.video) await this.downloadStream(task, selection.video, 'video');
        if (selection.audio) await this.downloadStream(task, selection.audio, 'audio');
        if (task.audioOnly) {
          await this.safeMove(await this.partPath(task, 'audio'), task.outputPath);
        } else {
          task.status = 'merging';
          this.emit(true);
          await mergeMedia(
            await this.partPath(task, 'video'),
            await this.partPath(task, 'audio'),
            task.outputPath,
          );
          await Promise.allSettled([
            RNFS.unlink(await this.partPath(task, 'video')),
            RNFS.unlink(await this.partPath(task, 'audio')),
          ]);
        }
      }

      if (task.withExtras) {
        try {
          await this.writeExtras(task, video, page);
        } catch {
          // 附加文件失败不影响主任务
        }
      }

      task.status = 'completed';
      task.progress = 100;
      task.speed = 0;
      task.updatedAt = Date.now();
      await this.store.saveTasks();
    } catch (error) {
      task.status = 'failed';
      task.error = this.cleanError(error);
      task.speed = 0;
      task.updatedAt = Date.now();
      await this.store.saveTasks();
    } finally {
      this.active.delete(id);
      this.jobIds.delete(id);
      this.emit(true);
      this.pump();
    }
  }

  private async getVideoInfo(task: DownloadTask): Promise<VideoInfo> {
    // 通过 view 接口拿完整信息（含 pages/pubdate），供 NFO 与分集标题使用
    const data = await this.client.parseVideo(`BV${task.bvid.slice(2)}`);
    return data;
  }

  private async downloadStream(task: DownloadTask, stream: MediaStream, key: string): Promise<void> {
    const destination = await this.partPath(task, key);
    const urls = [stream.url, ...stream.backupUrls];
    let lastError: unknown;
    for (const url of urls) {
      try {
        await this.downloadUrl(task, url, destination, key);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('下载失败');
  }

  /** 单文件下载：读取 .part 现有大小，带 Range 断点续传，用 RNFS 原生进度回调 */
  private async downloadUrl(task: DownloadTask, url: string, destination: string, key: string): Promise<void> {
    let existing = 0;
    try {
      if (await RNFS.exists(destination)) existing = (await RNFS.stat(destination)).size;
    } catch {
      existing = 0;
    }
    const headers: Record<string, string> = { ...this.client.headers() };
    if (existing > 0) headers.Range = `bytes=${existing}-`;

    let lastTick = Date.now();
    let lastBytes = existing;
    const result = await new Promise<{ statusCode: number; bytesWritten: number }>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      try {
        const { jobId, promise } = RNFS.downloadFile({
          fromUrl: url,
          toFile: destination,
          headers,
          background: true,
          progressDivider: 1,
          progressInterval: 400,
          begin: (res) => {
            task.totalBytes = res.contentLength + existing;
            this.emit();
          },
          progress: (res) => {
            const now = Date.now();
            const elapsed = (now - lastTick) / 1000;
            if (elapsed >= 0.5) {
              task.speed = Math.max(0, (res.bytesWritten - lastBytes) / elapsed);
              lastTick = now;
              lastBytes = res.bytesWritten;
            }
            task.downloadedBytes = res.bytesWritten + existing;
            task.progress = task.totalBytes > 0 ? Math.min(99, (task.downloadedBytes / task.totalBytes) * 100) : 0;
            this.emit();
          },
        });
        this.jobIds.set(task.id, jobId);
        promise
          .then((res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
              done(() => resolve({ statusCode: res.statusCode, bytesWritten: res.bytesWritten }));
            } else {
              done(() => reject(new Error(`下载失败 (HTTP ${res.statusCode})`)));
            }
          })
          .catch((error) => done(() => reject(error)));
      } catch (error) {
        done(() => reject(error));
      }
    });
    if (result.bytesWritten <= 0 && existing > 0) {
      // 服务器忽略了 Range 又返回 200，文件可能已被重写，属正常情况
    }
  }

  /** 移动文件到目标路径（目标存在则先删除，保证覆盖） */
  private async safeMove(from: string, to: string): Promise<void> {
    try {
      if (await RNFS.exists(to)) await RNFS.unlink(to);
    } catch {
      // 忽略删除失败，moveFile 会报错
    }
    await RNFS.moveFile(from, to);
  }

  private async partPath(task: DownloadTask, key: string): Promise<string> {
    return joinPath(task.outputDir, `${task.id}.${key}.part`);
  }

  private async uniqueOutputPath(outputDir: string, baseName: string, extension: string): Promise<string> {
    let candidate = joinPath(outputDir, `${baseName}.${extension}`);
    let index = 1;
    const existingPaths = new Set(this.store.getTasks().map((task) => task.outputPath));
    while ((await RNFS.exists(candidate)) || existingPaths.has(candidate)) {
      candidate = joinPath(outputDir, `${baseName} (${index}).${extension}`);
      index++;
    }
    return candidate;
  }

  private async writeExtras(task: DownloadTask, video: VideoInfo, page: VideoPage): Promise<void> {
    const baseName = task.outputPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? task.bvid;
    const input: Parameters<typeof writeExtraFiles>[0] = {
      video,
      page,
      outputDir: task.outputDir,
      baseName,
    };
    try {
      input.cover = await this.client.fetchCover(video.cover);
    } catch {
      // 封面失败不影响其他附加文件
    }
    if (task.subtitleLan && task.subtitleLan !== 'none') {
      try {
        const options = await this.client.getSubtitles(task.bvid, task.cid);
        const chosen = pickSubtitle(options, task.subtitleLan);
        if (chosen) {
          const cues = await this.client.fetchSubtitle(chosen.url);
          if (cues.length) input.subtitle = { language: chosen.lan, cues };
        }
      } catch {
        // 字幕失败不影响其他附加文件
      }
    }
    if (task.withDanmaku) {
      try {
        input.danmakuXml = await this.client.getDanmaku(task.cid);
      } catch {
        // 弹幕失败不影响其他附加文件
      }
    }
    await writeExtraFiles(input);
  }

  private cleanError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, '[地址已隐藏]').slice(0, 500);
  }

  private emit(force = false): void {
    const run = () => this.onChange(this.store.getTasks().map((task) => ({ ...task })));
    if (force) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = 0;
      run();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = 0;
      run();
    }, 180) as unknown as number;
  }
}
