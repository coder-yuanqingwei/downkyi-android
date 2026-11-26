import type { QrLoginResult, QrLoginSession, QrLoginStatus } from '../shared/types';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';

interface BiliResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface GenerateData {
  url: string;
  qrcode_key: string;
}

interface PollData {
  url: string;
  code: number;
  message: string;
}

const STATUS_BY_CODE: Record<number, QrLoginStatus> = {
  0: 'success',
  86038: 'expired',
  86039: 'pending',
  86090: 'scanned',
};

const COOKIE_KEYS = ['SESSDATA', 'bili_jct', 'sid', 'DedeUserID', 'DedeUserID__ckMd5', 'buvid3', 'buvid4'];

export class LoginCancelledError extends Error {
  constructor() {
    super('登录已取消');
    this.name = 'LoginCancelledError';
  }
}

/** 从 Headers 中解析 Set-Cookie（兼容 Node 22 的 getSetCookie；RN 走降级分支）。 */
function parseSetCookies(headers: Headers): Map<string, string> {
  const result = new Map<string, string>();
  let raw: string[];
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    raw = withGetSetCookie.getSetCookie();
  } else {
    // RN 的 Headers 把多个 Set-Cookie 合并成一个字符串，按 ", " 拆分后再解析
    const single = headers.get('set-cookie');
    raw = single ? single.split(/,\s*(?=[A-Za-z0-9_-]+=)/) : [];
  }
  for (const line of raw) {
    const pair = line.split(';')[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name && value) result.set(name, value);
  }
  return result;
}

function cookieString(cookies: Map<string, string>, keys = COOKIE_KEYS): string {
  return keys
    .filter((key) => cookies.has(key))
    .map((key) => `${key}=${cookies.get(key)}`)
    .join('; ');
}

/** 从登录成功返回的 URL 中提取 Cookie（兼容旧版把 Cookie 拼在 URL 上的行为）。 */
export function extractLoginCookie(url: string): string {
  let params: URLSearchParams;
  try {
    params = new URL(url, 'https://www.bilibili.com').searchParams;
  } catch {
    throw new Error('登录响应格式异常');
  }
  const cookies = new Map<string, string>();
  for (const key of COOKIE_KEYS) {
    const value = params.get(key);
    if (value) cookies.set(key, value);
  }
  return cookieString(cookies);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LoginCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LoginCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 网络请求带有限重试，避免偶发抖动导致登录中断。 */
async function fetchWithRetry(url: string, headers: Record<string, string>, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, { headers });
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('网络请求失败');
}

export class BilibiliLogin {
  private headers(): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
    };
  }

  async generate(): Promise<QrLoginSession> {
    const response = await fetchWithRetry(GENERATE_URL, this.headers());
    if (!response.ok) throw new Error(`生成二维码失败 (${response.status})`);
    const body = (await response.json()) as BiliResponse<GenerateData>;
    if (body.code !== 0 || !body.data?.qrcode_key || !body.data?.url) {
      throw new Error(body.message || '生成二维码失败');
    }
    return { url: body.data.url, qrcodeKey: body.data.qrcode_key };
  }

  async poll(qrcodeKey: string): Promise<QrLoginResult> {
    const query = new URLSearchParams({ qrcode_key: qrcodeKey });
    const response = await fetchWithRetry(`${POLL_URL}?${query}`, this.headers());
    if (!response.ok) throw new Error(`查询登录状态失败 (${response.status})`);
    const body = (await response.json()) as BiliResponse<PollData>;
    if (body.code !== 0 || !body.data) throw new Error(body.message || '查询登录状态失败');
    const status = STATUS_BY_CODE[body.data.code] ?? 'pending';
    const result: QrLoginResult = { status, message: body.data.message || this.statusMessage(status) };
    if (status === 'success') result.cookie = await this.collectCookies(response.headers, body.data.url);
    return result;
  }

  /** 新版通过 Set-Cookie 下发；旧版拼在 URL 上；都没有时用 ticket 跨域换取。 */
  private async collectCookies(headers: Headers, url: string): Promise<string> {
    const fromHeaders = parseSetCookies(headers);
    const cookie = cookieString(fromHeaders);
    if (cookie.includes('SESSDATA=')) return cookie;

    const fromUrl = extractLoginCookie(url);
    if (fromUrl.includes('SESSDATA=')) return fromUrl;

    let ticket: string | null = null;
    try {
      ticket = new URL(url, 'https://www.bilibili.com').searchParams.get('ticket');
    } catch {
      // URL 异常则跳过 ticket 换取
    }
    if (ticket) {
      const exchanged = await this.exchangeTicket(ticket, url);
      const value = cookieString(exchanged);
      if (value.includes('SESSDATA=')) return value;
    }
    throw new Error(
      `登录未返回 SESSDATA（Cookie 字段：${[...fromHeaders.keys()].join(', ') || '无'}；URL：${url.slice(0, 200)}）`,
    );
  }

  /** 拿跨域 ticket 换取真实 Cookie（2026 年改版后的中间步骤）。 */
  private async exchangeTicket(ticket: string, gourl: string): Promise<Map<string, string>> {
    const encoded = encodeURIComponent(gourl);
    const urls = [
      `https://passport.biligame.com/x/passport-login/web/crossDomain?ticket=${ticket}&gourl=${encoded}`,
      `https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=${ticket}&gourl=${encoded}`,
    ];
    const cookies = new Map<string, string>();
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: this.headers() });
        for (const [key, value] of parseSetCookies(response.headers)) cookies.set(key, value);
        if (cookies.has('SESSDATA')) break;
      } catch {
        // 尝试下一个域名
      }
    }
    return cookies;
  }

  /** 持续轮询直到扫码成功、二维码过期、超时或被取消。 */
  async waitForLogin(
    qrcodeKey: string,
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
      onStatus?: (result: QrLoginResult) => void;
    } = {},
  ): Promise<string> {
    const { intervalMs = 1500, timeoutMs = 180_000, signal, onStatus } = options;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new LoginCancelledError();
      const result = await this.poll(qrcodeKey);
      onStatus?.(result);
      if (result.status === 'success') {
        if (!result.cookie) throw new Error('登录成功但未获取到 Cookie，请重试');
        return result.cookie;
      }
      if (result.status === 'expired') throw new Error('二维码已过期，请重新执行登录');
      await delay(intervalMs, signal);
    }
    throw new Error('登录超时，请重新扫码');
  }

  private statusMessage(status: QrLoginStatus): string {
    if (status === 'success') return '登录成功';
    if (status === 'scanned') return '已扫码，请在手机上确认';
    if (status === 'expired') return '二维码已过期';
    return '等待扫码';
  }
}
