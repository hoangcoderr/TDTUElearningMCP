import fs from "node:fs";
import path from "node:path";
import {
  clearTokenCache,
  Config,
  ConfigError,
  readTokenCache,
  writeTokenCache,
} from "./config.js";

export class MoodleError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "MoodleError";
  }
}

export type Params = Record<string, unknown>;

/** Chuyển object/array lồng nhau thành flat params kiểu Moodle: a[0][b]=x */
export function flattenParams(params: Params, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  const assign = (key: string, raw: unknown): void => {
    if (raw === undefined || raw === null || raw === "") return;
    if (typeof raw === "boolean") {
      out[key] = raw ? "1" : "0";
      return;
    }
    if (Array.isArray(raw)) {
      raw.forEach((v, i) => assign(`${key}[${i}]`, v));
    } else if (typeof raw === "object") {
      if (raw instanceof Date) {
        out[key] = String(Math.floor(raw.getTime() / 1000));
      } else if (Buffer.isBuffer(raw)) {
        out[key] = raw.toString("utf8");
      } else {
        flattenParams(raw as Params, key, out);
      }
    } else {
      out[key] = String(raw);
    }
  };

  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    assign(key, v);
  }
  return out;
}

function describeError(payload: any): MoodleError {
  const code = payload?.errorcode ?? payload?.code ?? "unknown";
  const message = payload?.message ?? payload?.error ?? JSON.stringify(payload);
  const debug = payload?.debuginfo ? `\nChi tiết: ${String(payload.debuginfo).slice(0, 500)}` : "";
  return new MoodleError(`${message}${debug}`, code, payload);
}

export interface UploadResult {
  itemid: number;
  contextid: number;
  filename: string;
}

export class MoodleApi {
  private token: string | null = null;
  private privToken: string | null = null;
  private siteInfoCache: any = null;
  private functionsCache: string[] | null = null;
  private loginInFlight: Promise<string> | null = null;

  constructor(readonly cfg: Config) {
    const cached = readTokenCache(cfg);
    if (cached) {
      this.token = cached.token;
      this.privToken = cached.privatetoken ?? null;
    }
  }

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  get currentToken(): string | null {
    return this.token;
  }

  async login(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      const body = new URLSearchParams({
        username: this.cfg.username,
        password: this.cfg.password,
        service: this.cfg.service,
      });
      const res = await this.rawFetch(`${this.cfg.baseUrl}/login/token.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new MoodleError(`Không đọc được phản hồi đăng nhập (HTTP ${res.status}).`, "badresponse", text.slice(0, 300));
      }
      if (data.error) {
        throw new MoodleError(`Đăng nhập thất bại: ${data.error}`, data.errorcode ?? "loginfailed");
      }
      if (!data.token) {
        throw new MoodleError("Moodle không trả về token.", "notoken", data);
      }
      this.token = data.token;
      this.privToken = data.privatetoken ?? null;
      const site = await this.siteInfo().catch(() => null);
      writeTokenCache(this.cfg, {
        token: this.token as string,
        privatetoken: this.privToken ?? undefined,
        userid: site?.userid,
      });
      if (!this.token) throw new MoodleError("Không nhận được token sau đăng nhập.", "notoken");
      return this.token;
    })();
    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = null;
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new MoodleError(`Quá thời gian chờ (${this.cfg.timeoutMs}ms) khi gọi ${url}`, "timeout");
      }
      throw new MoodleError(`Không kết nối được ${url}: ${e?.message ?? e}`, "network");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Gọi một webservice function của Moodle.
   * Tự đăng nhập lại nếu token hết hạn.
   */
  async call<T = any>(wsfunction: string, params: Params = {}, opts: { retry?: boolean } = {}): Promise<T> {
    const token = await this.ensureToken();
    const body = new URLSearchParams();
    body.set("wstoken", token);
    body.set("wsfunction", wsfunction);
    body.set("moodlewsrestformat", "json");
    for (const [k, v] of Object.entries(flattenParams(params))) body.set(k, v);

    const res = await this.rawFetch(`${this.cfg.baseUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new MoodleError(
        `Phản hồi không phải JSON từ ${wsfunction} (HTTP ${res.status}).`,
        "badresponse",
        text.slice(0, 400),
      );
    }

    if (data && typeof data === "object" && !Array.isArray(data) && data.exception) {
      const code = data.errorcode as string | undefined;
      if ((code === "invalidtoken" || code === "issingletoken" || code === "expiredtoken") && opts.retry !== false) {
        clearTokenCache(this.cfg);
        this.token = null;
        await this.login();
        return this.call<T>(wsfunction, params, { ...opts, retry: false });
      }
      throw describeError(data);
    }
    return data as T;
  }

  async siteInfo(): Promise<any> {
    if (this.siteInfoCache) return this.siteInfoCache;
    this.siteInfoCache = await this.call("core_webservice_get_site_info");
    return this.siteInfoCache;
  }

  async userId(): Promise<number> {
    const info = await this.siteInfo();
    return Number(info.userid);
  }

  /** Danh sách tên các webservice function mà site cho phép gọi. */
  async functions(): Promise<string[]> {
    if (this.functionsCache) return this.functionsCache;
    const info = await this.siteInfo();
    const list: string[] = (info.functions ?? []).map((f: any) => f.name).sort();
    this.functionsCache = list;
    return list;
  }

  /**
   * Upload file vào một draft area rồi trả về itemid để dùng trong submission.
   * Gọi `/webservice/upload.php` — param bắt buộc là `token` (không phải `wstoken`).
   */
  async uploadFile(filePath: string, opts: { itemid: number; filearea?: string; ctxId?: number } = { itemid: 0 }): Promise<UploadResult> {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) throw new MoodleError(`Không tìm thấy file: ${abs}`, "filenotfound");
    const buf = fs.readFileSync(abs);
    const token = await this.ensureToken();

    const form = new FormData();
    form.set("token", token);
    form.set("filearea", opts.filearea ?? "draft");
    form.set("itemid", String(opts.itemid));
    form.set("repo_id", "1");
    if (opts.ctxId !== undefined) form.set("ctx_id", String(opts.ctxId));
    form.set("overwrite", "1");
    form.set("filename", path.basename(abs));
    form.set("file", new Blob([new Uint8Array(buf)]), path.basename(abs));

    const res = await this.rawFetch(`${this.cfg.baseUrl}/webservice/upload.php`, { method: "POST", body: form });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new MoodleError(`Upload không trả JSON (HTTP ${res.status}).`, "badresponse", text.slice(0, 400));
    }
    if (Array.isArray(data) && data.length) {
      return { itemid: Number(data[0].itemid), contextid: Number(data[0].contextid), filename: data[0].filename };
    }
    throw describeError(data);
  }

  /** Tải một file từ Moodle (pluginfile/URL) về máy. Tự gắn token nếu là pluginfile. */
  async downloadFile(fileUrl: string, destPath?: string): Promise<{ path: string; bytes: number }> {
    let url = fileUrl;
    if (url.includes("/pluginfile.php") && !/[?&]token=/.test(url)) {
      const token = await this.ensureToken();
      url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
    }
    const res = await this.rawFetch(url, { method: "GET" });
    if (!res.ok) throw new MoodleError(`Tải file thất bại HTTP ${res.status}: ${fileUrl}`, "http" + res.status);
    const buf = Buffer.from(await res.arrayBuffer());

    let out = destPath;
    if (!out) {
      const name = decodeURIComponent(path.basename(new URL(url).pathname)) || "download.bin";
      out = path.join(this.cfg.downloadDir, `${Date.now()}_${name.replace(/[^\w.\-]+/g, "_")}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    return { path: out, bytes: buf.length };
  }

  /** Đính kèm token vào fileurl của Moodle để tải/open trực tiếp. */
  async withToken(fileUrl: string): Promise<string> {
    if (!fileUrl || !fileUrl.includes("/pluginfile.php") || /[?&]token=/.test(fileUrl)) return fileUrl;
    const token = await this.ensureToken();
    return fileUrl + (fileUrl.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
  }
}

export { ConfigError };
