import RNFS from '@dr.pogodin/react-native-fs';
import type { SubtitleCue, SubtitleOption, VideoInfo, VideoPage } from '../shared/types';

/** 简单路径拼接（RN 端路径统一用 / 分隔） */
function joinPath(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, '')}/${file}`;
}

/** 把秒数格式化为 SRT 时间戳 HH:MM:SS,mmm */
export function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/** 字幕 JSON → SRT 文本 */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.from)} --> ${formatSrtTime(cue.to)}\n${cue.text.replace(/\n/g, ' ')}\n`,
    )
    .join('\n');
}

/** 弹幕 XML → ASS 文本（仅滚动/顶部/底部三种常见类型） */
export function danmakuToAss(xml: string): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events: string[] = [];
  const regex = /<d p="([^"]+)">([^<]*)<\/d>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const fields = match[1].split(',');
    const start = Number(fields[0]) || 0;
    const mode = Number(fields[1]) || 1;
    const color = Number(fields[3]) || 0xffffff;
    const text = decodeXml(match[2]);
    if (!text) continue;
    const assColor = `&H00${((color & 0xff) << 16 | (color & 0xff00) | ((color >> 16) & 0xff)).toString(16).padStart(6, '0')}`;
    // B站 mode: 1/2/3 滚动, 4 底部, 5 顶部；ASS an: 2 底部居中, 8 顶部居中
    const align = mode === 5 ? 8 : 2;
    const startTs = assTime(start);
    const endTs = assTime(start + 5);
    events.push(`Dialogue: 0,${startTs},${endTs},Default,,0,0,0,,{\\an${align}\\c${assColor}}${text}`);
  }
  return [...header, ...events].join('\n') + '\n';
}

function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 生成 Kodi/Jellyfin 兼容的 NFO 元数据 */
export function buildNfo(video: VideoInfo, page?: VideoPage): string {
  const date = video.publishedAt > 0 ? new Date(video.publishedAt * 1000).toISOString().slice(0, 10) : '';
  const dateFields = date
    ? `  <year>${date.slice(0, 4)}</year>\n  <premiered>${date}</premiered>\n  <releasedate>${date}</releasedate>\n`
    : '';
  const title = page ? `${video.title} - ${page.title}` : video.title;
  return `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>${escapeXml(title)}</title>
  <originaltitle>${escapeXml(video.title)}</originaltitle>
  <showtitle>${escapeXml(video.title)}</showtitle>
  <artist>${escapeXml(video.owner)}</artist>
${dateFields}  <plot>${escapeXml(video.description)}</plot>
  <runtime>${Math.round((page?.duration ?? video.duration) / 60)}</runtime>
  <id>${video.bvid}</id>
  <source>Bilibili</source>
</movie>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把视频附加内容（封面、NFO、字幕、弹幕）写到输出目录 */
export interface ExtraFiles {
  video: VideoInfo;
  page: VideoPage;
  outputDir: string;
  baseName: string;
  cover?: string; // base64 编码的 JPEG（RN 无 Buffer）
  subtitle?: { language: string; cues: SubtitleCue[] };
  danmakuXml?: string;
}

export async function writeExtraFiles(input: ExtraFiles): Promise<string[]> {
  await RNFS.mkdir(input.outputDir);
  const written: string[] = [];
  const write = async (file: string, content: string, encoding: 'utf8' | 'base64' = 'utf8') => {
    await RNFS.writeFile(joinPath(input.outputDir, file), content, encoding);
    written.push(file);
  };

  if (input.cover) await write('poster.jpg', input.cover, 'base64');
  await write(`${input.baseName}.nfo`, buildNfo(input.video, input.page));
  if (input.subtitle?.cues.length) {
    const suffix = input.subtitle.language ? `.${input.subtitle.language}` : '';
    await write(`${input.baseName}${suffix}.srt`, cuesToSrt(input.subtitle.cues));
  }
  if (input.danmakuXml) await write(`${input.baseName}.ass`, danmakuToAss(input.danmakuXml));
  return written;
}

/** 选择最匹配语言的字幕 */
export function pickSubtitle(options: SubtitleOption[], preferred: string): SubtitleOption | undefined {
  if (!options.length) return undefined;
  return options.find((item) => item.lan === preferred) ?? options.find((item) => item.url) ?? options[0];
}
