export interface VideoReference {
  type: 'bvid' | 'aid';
  value: string;
}

export function parseVideoReference(input: string): VideoReference {
  const value = input.trim();
  if (!value) {
    throw new Error('请先粘贴视频链接或 BV 号');
  }

  const bvid = value.match(/BV[0-9a-zA-Z]{10}/i)?.[0];
  if (bvid) {
    return { type: 'bvid', value: `BV${bvid.slice(2)}` };
  }

  const av = value.match(/(?:^|[^a-zA-Z])av(\d+)/i)?.[1] ?? value.match(/^(\d+)$/)?.[1];
  if (av) {
    return { type: 'aid', value: av };
  }

  throw new Error('未识别到有效的 BV 号、av 号或视频链接');
}

export function isBilibiliShortLink(input: string): boolean {
  try {
    return new URL(input.trim()).hostname === 'b23.tv';
  } catch {
    return false;
  }
}

/**
 * 从任意粘贴内容（分享文本、带标题的链接等）中提取第一个 URL。
 * 例如「【标题-哔哩哔哩】 https://b23.tv/xxx」→「https://b23.tv/xxx」。
 */
export function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s"'（）()【】\[\]，,<>]+/i);
  return match?.[0] ?? null;
}

interface FileNameData {
  title: string;
  part: string;
  owner: string;
  bvid: string;
  quality: string;
}

export function sanitizeFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const withoutReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)
    ? `-${sanitized}`
    : sanitized;
  return withoutReservedName.slice(0, 140);
}

export function buildFileName(template: string, data: FileNameData): string {
  const rendered = template.replace(/\{(title|part|owner|bvid|quality)\}/g, (_, key: keyof FileNameData) => data[key]);
  return sanitizeFileName(rendered) || sanitizeFileName(`${data.title}-${data.bvid}`);
}