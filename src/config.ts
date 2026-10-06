import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  baseUrl: string;
  username: string;
  password: string;
  service: string;
  cachePath: string;
  timeoutMs: number;
  downloadDir: string;
}

export class ConfigError extends Error {}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "tdtu-mcp");
}

function pick(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

export function loadConfig(): Config {
  const baseUrl = (pick("TDTU_ELEARNING_URL", "TDTU_BASE_URL") || "https://elearning.tdtu.edu.vn").replace(/\/+$/, "");
  const username = pick("TDTU_MSSV", "TDTU_USERNAME", "MOODLE_USERNAME") || "";
  const password = pick("TDTU_PASSWORD", "TDTU_PASS", "MOODLE_PASSWORD") || "";
  const service = pick("TDTU_SERVICE", "MOODLE_SERVICE") || "moodle_mobile_app";
  const timeoutMs = Number(pick("TDTU_TIMEOUT_MS") || 60000);
  const downloadDir = pick("TDTU_DOWNLOAD_DIR") || path.join(os.homedir(), "Downloads", "tdtu-mcp");

  if (!username || !password) {
    throw new ConfigError(
      "Thiếu thông tin đăng nhập. Hãy set biến môi trường TDTU_MSSV (mã số sinh viên) và TDTU_PASSWORD (mật khẩu).",
    );
  }

  return {
    baseUrl,
    username,
    password,
    service,
    cachePath: path.join(configDir(), "token.json"),
    timeoutMs,
    downloadDir,
  };
}

interface TokenCache {
  baseUrl: string;
  username: string;
  service: string;
  token: string;
  privatetoken?: string;
  userid?: number;
  createdAt: number;
}

export function readTokenCache(cfg: Config): TokenCache | null {
  try {
    const raw = fs.readFileSync(cfg.cachePath, "utf8");
    const data = JSON.parse(raw) as TokenCache;
    if (data.baseUrl !== cfg.baseUrl || data.username !== cfg.username || data.service !== cfg.service) return null;
    if (!data.token) return null;
    if (Date.now() - data.createdAt > 1000 * 60 * 60 * 24 * 6) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeTokenCache(cfg: Config, data: Omit<TokenCache, "baseUrl" | "username" | "service" | "createdAt">): void {
  fs.mkdirSync(path.dirname(cfg.cachePath), { recursive: true, mode: 0o700 });
  const payload: TokenCache = {
    baseUrl: cfg.baseUrl,
    username: cfg.username,
    service: cfg.service,
    createdAt: Date.now(),
    ...data,
  };
  fs.writeFileSync(cfg.cachePath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
}

export function clearTokenCache(cfg: Config): void {
  try {
    fs.unlinkSync(cfg.cachePath);
  } catch {
    /* ignore */
  }
}
