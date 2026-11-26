import { extractFirstUrl, isBilibiliShortLink, parseVideoReference } from '../shared/bilibili';
import type { QualityOption, SubtitleCue, SubtitleOption, VideoInfo } from '../shared/types';

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

interface BiliResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface ViewData {
  aid: number;
  bvid: string;
  title: string;
  desc: string;
  pic: string;
  duration: number;
  pubdate: number;
  owner: { name: string };
  stat: { view: number };
  pages: Array<{ cid: number; page: number; part: string; duration: number }>;
}

export interface MediaStream {
  id: number;
  url: string;
  backupUrls: string[];
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
}

interface DurlItem {
  url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  size?: number;
  length?: number;
}

interface PlayData {
  accept_quality: number[];
  accept_description: string[];
  quality?: number;
  format?: string;
  dash?: {
    video?: Array<{
      id: number;
      baseUrl?: string;
      base_url?: string;
      backupUrl?: string[];
      backup_url?: string[];
      bandwidth: number;
      width: number;
      height: number;
      codecs: string;
    }>;
    audio?: Array<{
      id: number;
      baseUrl?: string;
      base_url?: string;
      backupUrl?: string[];
      backup_url?: string[];
      bandwidth: number;
      width?: number;
      height?: number;
      codecs: string;
    }>;
  } | null;
  durl?: DurlItem[];
}

export interface PlaySelection {
  video?: MediaStream;
  audio?: MediaStream;
  /** 单个已合并的音视频文件（durl / MP4 格式），存在时无需 FFmpeg 合并 */
  file?: MediaStream;
}

/** ArrayBuffer → base64（纯 JS 实现，不依赖 Buffer/btoa） */
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : chars[c & 63];
  }
  return out;
}

export class BilibiliClient {
  constructor(private readonly getCookie: () => string = () => '') {}

  async parseVideo(input: string): Promise<VideoInfo> {
    let value = input.trim();
    // 兼容分享文本（如「【标题-哔哩哔哩】 https://b23.tv/xxx」）：先提取出纯链接
    value = extractFirstUrl(value) ?? value;
    if (isBilibiliShortLink(value)) {
      const response = await fetch(value, { headers: this.headers() });
      if (!response.ok) throw new Error('短链接解析失败，请稍后重试');
      value = response.url;
    }
    const reference = parseVideoReference(value);
    const query = reference.type === 'bvid' ? `bvid=${reference.value}` : `aid=${reference.value}`;
    const data = await this.request<ViewData>(`https://api.bilibili.com/x/web-interface/view?${query}`);
    return {
      aid: data.aid,
      bvid: data.bvid,
      title: data.title,
      description: data.desc,
      cover: data.pic,
      owner: data.owner.name,
      duration: data.duration,
      viewCount: data.stat.view,
      publishedAt: data.pubdate,
      pages: data.pages.map((page) => ({
        cid: page.cid,
        index: page.page,
        title: page.part,
        duration: page.duration,
      })),
    };
  }

  async getQualities(bvid: string, cid: number): Promise<QualityOption[]> {
    const play = await this.getPlayData(bvid, cid, 120);
    const labels = new Map(
      play.accept_quality.map((id, index) => [id, play.accept_description[index] ?? `画质 ${id}`]),
    );
    const seen = new Map<number, QualityOption>();
    for (const stream of play.dash?.video ?? []) {
      if (seen.has(stream.id)) continue;
      seen.set(stream.id, {
        id: stream.id,
        label: labels.get(stream.id) ?? `${stream.height}P`,
        width: stream.width,
        height: stream.height,
      });
    }
    if (seen.size) return [...seen.values()].sort((a, b) => b.id - a.id);
    const id = play.quality ?? play.accept_quality[0] ?? 80;
    return [{ id, label: labels.get(id) ?? `画质 ${id}`, width: 0, height: 0 }];
  }

  async getSubtitles(bvid: string, cid: number): Promise<SubtitleOption[]> {
    type Sub = { lan: string; lan_doc: string; subtitle_url: string };
    const toOptions = (subs: Sub[]): SubtitleOption[] =>
      subs
        .filter((item) => Boolean(item.subtitle_url))
        .map((item) => ({
          lan: item.lan,
          label: item.lan_doc || item.lan,
          url: item.subtitle_url.startsWith('//') ? `https:${item.subtitle_url}` : item.subtitle_url,
        }));

    for (const api of ['x/player/wbi/v2', 'x/player/v2']) {
      try {
        const data = await this.request<{ subtitle?: { subtitles?: Sub[] } }>(
          `https://api.bilibili.com/${api}?bvid=${bvid}&cid=${cid}`,
        );
        const options = toOptions(data.subtitle?.subtitles ?? []);
        if (options.length) return options;
      } catch {
        // 尝试下一个接口
      }
    }
    return [];
  }

  async fetchSubtitle(url: string): Promise<SubtitleCue[]> {
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`字幕下载失败 (${response.status})`);
    const body = (await response.json()) as { body?: Array<{ from: number; to: number; content: string }> };
    return (body.body ?? []).map((item) => ({ from: item.from, to: item.to, text: item.content }));
  }

  async getDanmaku(cid: number): Promise<string> {
    const response = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`弹幕下载失败 (${response.status})`);
    return response.text();
  }

  /** 下载封面，返回 base64 数据（RN 无 Buffer） */
  async fetchCover(url: string): Promise<string> {
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`封面下载失败 (${response.status})`);
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  }

  async selectStreams(bvid: string, cid: number, quality: number, audioOnly: boolean): Promise<PlaySelection> {
    const play = await this.getPlayData(bvid, cid, quality);
    const videos = (play.dash?.video ?? []).map((stream) => this.mapStream(stream));
    const audioStreams = (play.dash?.audio ?? []).map((stream) => this.mapStream(stream));
    const video = audioOnly
      ? undefined
      : videos
          .filter((stream) => stream.id <= quality)
          .sort((a, b) => b.id - a.id || b.bandwidth - a.bandwidth)[0] ?? videos[0];
    const audio = audioStreams.sort((a, b) => b.bandwidth - a.bandwidth)[0];

    if ((!audioOnly && !video) || !audio) {
      const file = this.selectDurl(play, quality);
      if (file) return { file };
    }

    if (!audioOnly && !video) throw new Error('当前视频没有可用的视频流，请尝试登录或降低画质');
    if (!audio) throw new Error('当前视频没有可用的音频流');
    return { video, audio };
  }

  private selectDurl(play: PlayData, quality: number): MediaStream | undefined {
    const item = play.durl?.find((durl) => Boolean(durl.url));
    if (!item?.url) return undefined;
    return {
      id: play.quality ?? quality,
      url: item.url,
      backupUrls: item.backupUrl ?? item.backup_url ?? [],
      bandwidth: item.size ?? 0,
      width: 0,
      height: 0,
      codecs: '',
    };
  }

  headers(): Record<string, string> {
    const cookie = this.getCookie().trim();
    return {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      ...(cookie ? { Cookie: cookie } : {}),
    };
  }

  private async getPlayData(bvid: string, cid: number, quality: number): Promise<PlayData> {
    const query = new URLSearchParams({
      bvid,
      cid: String(cid),
      qn: String(quality),
      fnval: '16',
      fourk: '1',
    });
    return this.request<PlayData>(`https://api.bilibili.com/x/player/playurl?${query}`);
  }

  private mapStream(stream: {
    id: number;
    baseUrl?: string;
    base_url?: string;
    backupUrl?: string[];
    backup_url?: string[];
    bandwidth: number;
    width?: number;
    height?: number;
    codecs: string;
  }): MediaStream {
    const url = stream.baseUrl ?? stream.base_url;
    if (!url) throw new Error('媒体地址为空，请稍后重试');
    return {
      id: stream.id,
      url,
      backupUrls: stream.backupUrl ?? stream.backup_url ?? [],
      bandwidth: stream.bandwidth,
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      codecs: stream.codecs,
    };
  }

  private async request<T>(url: string): Promise<T> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(url, { headers: this.headers() });
      if (!response.ok) throw new Error(`网络请求失败 (${response.status})`);
      const body = (await response.json()) as BiliResponse<T>;
      if (body.code === 87008 && attempt < maxAttempts) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), attempt * 1500));
        continue;
      }
      if (body.code !== 0) {
        let message = body.message || '解析失败';
        if (body.code === -404) message = '视频不存在或已被删除';
        else if (body.code === 87008) message = '该分集为充电专属内容，需对 UP 主充电后观看';
        throw new Error(message);
      }
      return body.data;
    }
    throw new Error('请求失败：接口限流，请稍后重试');
  }
}
