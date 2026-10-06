import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Trả kết quả tool dạng JSON text. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: safeStringify(data) }] };
}

export function fail(error: unknown): CallToolResult {
  const message =
    error instanceof Error
      ? `${error.name !== "Error" ? error.name + ": " : ""}${error.message}`
      : typeof error === "string"
        ? error
        : safeStringify(error);
  return { content: [{ type: "text", text: `LỖI: ${message}` }], isError: true };
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function fmtTime(ts?: number | string | null): string {
  const n = Number(ts);
  if (!n || !Number.isFinite(n)) return "";
  return new Date(n * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

export function fmtDate(ts?: number | string | null): string {
  const n = Number(ts);
  if (!n || !Number.isFinite(n)) return "";
  return new Date(n * 1000).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export interface Semester {
  /** VD: HK1_2026 */
  code: string;
  year: number;
  term: number;
}

const SEMESTER_RE = /\bHK\s*([1-4])\s*[_-]\s*(20\d{2})(?!\d)/i;

export function parseSemester(fullname: string): Semester | null {
  const m = SEMESTER_RE.exec(fullname ?? "");
  if (!m) return null;
  return { code: `HK${m[1]}_${m[2]}`, year: Number(m[2]), term: Number(m[1]) };
}

/** Học kỳ lớn nhất (mới nhất) trong danh sách môn. */
export function detectCurrentSemester(courses: { fullname?: string }[]): Semester | null {
  let best: Semester | null = null;
  for (const c of courses) {
    const s = parseSemester(c.fullname ?? "");
    if (!s) continue;
    if (!best || s.year > best.year || (s.year === best.year && s.term > best.term)) best = s;
  }
  return best;
}

export function semesterCourses<T extends { fullname?: string }>(courses: T[], semester: Semester): T[] {
  return courses.filter((c) => parseSemester(c.fullname ?? "")?.code === semester.code);
}

/** Phân loại module trong course contents theo loại bài. */
export type ContentCategory = "tai_lieu" | "lien_ket" | "nop_bai" | "bai_kiem_tra" | "thong_bao" | "khac";

const MOD_CATEGORY: Record<string, ContentCategory> = {
  resource: "tai_lieu",
  page: "tai_lieu",
  folder: "tai_lieu",
  book: "tai_lieu",
  imscp: "tai_lieu",
  url: "lien_ket",
  lti: "lien_ket",
  assign: "nop_bai",
  workshop: "nop_bai",
  quiz: "bai_kiem_tra",
  forum: "thong_bao",
};

export function categorize(modname: string): ContentCategory {
  return MOD_CATEGORY[modname] ?? "khac";
}

export const CATEGORY_LABEL: Record<ContentCategory, string> = {
  tai_lieu: "Tài liệu",
  lien_ket: "Liên kết",
  nop_bai: "Bài nộp (submission)",
  bai_kiem_tra: "Bài kiểm tra (quiz)",
  thong_bao: "Thông báo / Diễn đàn",
  khac: "Khác",
};

export const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as ContentCategory[];

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Bóc HTML cơ bản để đọc được mô tả bài tập. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
