import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, cached } from "../state.js";
import { enrolledCourses } from "./courses.js";
import {
  categorize,
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  ContentCategory,
  fmtTime,
  mapLimit,
  safeStringify,
  semesterCourses,
  detectCurrentSemester,
  stripHtml,
  truncate,
} from "../util.js";

interface ModuleSummary {
  id: number;
  instance: number;
  modname: string;
  name: string;
  category: ContentCategory;
  url?: string;
  files?: { filename: string; fileurl: string; filesize: number; mimetype?: string }[];
  intro?: string;
  completion?: number;
}

async function courseContents(courseid: number): Promise<any[]> {
  return cached(`contents:${courseid}`, 60_000, () => getApi().call("core_course_get_contents", { courseid }));
}

function summarizeModule(m: any): ModuleSummary {
  const files = (m.contents ?? [])
    .filter((c: any) => c.fileurl && c.type !== "url")
    .map((c: any) => ({
      filename: c.filename,
      fileurl: c.fileurl,
      filesize: c.filesize,
      mimetype: c.mimetype,
    }));
  return {
    id: m.id,
    instance: m.instance,
    modname: m.modname,
    name: m.name,
    category: categorize(m.modname),
    url: m.url,
    files: files.length ? files : undefined,
    intro: m.intro ? truncate(stripHtml(m.intro), 400) || undefined : undefined,
    completion: m.completion,
  };
}

export function registerContentTools(server: McpServer): void {
  server.registerTool(
    "get_course_contents",
    {
      title: "Nội dung môn học",
      description:
        "Lấy nội dung từng chương của một môn học, phân loại theo: tai_lieu (tài liệu/pdf/slide), lien_ket, nop_bai (bài nộp - submission), bai_kiem_tra (quiz), thong_bao (diễn đàn/announcements), khac. Kèm link file để tải về.",
      inputSchema: {
        courseid: z.number().int().describe("ID môn học (dùng list_courses để lấy)"),
        loai: z
          .enum(CATEGORY_OPTIONS as [ContentCategory, ...ContentCategory[]])
          .optional()
          .describe("Chỉ trả về một loại nội dung. Mặc định = tất cả."),
      },
    },
    async ({ courseid, loai }) => {
      const sections = await courseContents(courseid);
      const out = sections.map((s) => {
        const modules: ModuleSummary[] = (s.modules as any[] | undefined ?? []).map(summarizeModule);
        const filtered = loai ? modules.filter((m: ModuleSummary) => m.category === loai) : modules;
        return {
          chuong: s.name,
          dien_giai: s.summary ? truncate(stripHtml(s.summary), 300) : undefined,
          so_luong: filtered.length,
          muc: filtered.map((m: ModuleSummary) => ({
            id: m.id,
            loai: m.category,
            ten_loai: CATEGORY_LABEL[m.category],
            kieu: m.modname,
            ten: m.name,
            mo_ta: m.intro,
            url: m.url,
            files: m.files?.map((f: any) => ({ ...f, tai_ve: `download_file` })),
          })),
        };
      });
      const counts: Record<string, number> = {};
      for (const s of sections) for (const m of ((s.modules ?? []) as any[])) { const k = categorize(m.modname); counts[k] = (counts[k] ?? 0) + 1; }
      return {
        content: [
          {
            type: "text",
            text: safeStringify({ courseid, tong_theo_loai: counts, chuong: out.filter((s) => s.so_luong > 0 || !loai) }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_content_by_type",
    {
      title: "Danh sách bài theo loại (môn hiện tại)",
      description:
        "Gom tất cả nội dung của các môn trong học kỳ hiện tại (hoặc 1 môn) theo loại bài: tài liệu, bài nộp, thông báo, quiz, liên kết. Rất hợp để hỏi 'tôi có bài tập gì sắp tới'.",
      inputSchema: {
        courseid: z.number().int().optional().describe("Chỉ 1 môn. Bỏ trống = cả học kỳ hiện tại"),
        loai: z
          .enum(CATEGORY_OPTIONS as [ContentCategory, ...ContentCategory[]])
          .optional()
          .describe("Loại cần lọc"),
        gioi_han: z.number().int().min(1).max(500).optional().describe("Số mục tối đa mỗi loại (mặc định 100)"),
      },
    },
    async ({ courseid, loai, gioi_han }) => {
      const api = getApi();
      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      let targets = all;
      if (courseid) targets = all.filter((c) => c.id === courseid);
      else if (current) targets = semesterCourses(all, current);

      const perCourse = await mapLimit(targets, 4, async (c) => {
        const sections = await courseContents(c.id).catch(() => [] as any[]);
        const mods: any[] = [];
        for (const s of sections) for (const m of s.modules ?? []) mods.push({ ...summarizeModule(m), section: s.name, courseid: c.id, course: c.fullname });
        return mods;
      });

      const flat = perCourse.flat();
      const grouped: Record<string, any[]> = {};
      const kinds = loai ? [loai] : CATEGORY_OPTIONS;
      for (const k of kinds) {
        grouped[k] = flat
          .filter((m) => m.category === k)
          .slice(0, gioi_han ?? 100)
          .map((m) => ({
            courseid: m.courseid,
            mon: m.course,
            chuong: m.section,
            moduleid: m.id,
            instance: m.instance,
            ten: m.name,
            mo_ta: m.intro,
            url: m.url,
            files: m.files,
          }));
      }
      for (const k of Object.keys(grouped)) if (grouped[k].length === 0) delete grouped[k];

      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              hoc_ky: current?.code ?? null,
              so_mon: targets.length,
              tong_muc: flat.length,
              theo_loai: grouped,
              chu_thich: loai ? undefined : "mỗi key = một loại bài, key 'khac' = phần còn lại",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_announcements",
    {
      title: "Thông báo / Diễn đàn",
      description: "Lấy các thông báo (Announcements) và thảo luận mới nhất của diễn đàn trong một môn hoặc toàn bộ học kỳ hiện tại.",
      inputSchema: {
        courseid: z.number().int().optional().describe("ID môn. Bỏ trống = học kỳ hiện tại"),
        gioi_han: z.number().int().min(1).max(50).optional().describe("Số thảo luận tối đa mỗi forum (mặc định 10)"),
      },
    },
    async ({ courseid, gioi_han }) => {
      const api = getApi();
      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      let targets = all;
      if (courseid) targets = all.filter((c) => c.id === courseid);
      else if (current) targets = semesterCourses(all, current);
      targets = targets.slice(0, 60);

      const results = await mapLimit(targets, 4, async (c) => {
        const forums: any[] = await api.call("mod_forum_get_forums_by_courses", { courseids: [c.id] }).catch(() => []);
        if (!forums.length) return null;
        const discussions = await mapLimit(forums, 3, async (f) => {
          const d: any = await api
            .call("mod_forum_get_forum_discussions", { forumid: f.id, page: 1, perpage: gioi_han ?? 10 })
            .catch(() => ({ discussions: [] }));
          return {
            forumid: f.id,
            ten_forum: f.name,
            tong_thao_luan: (d.discussions ?? []).length,
            thao_luan: (d.discussions ?? []).map((x: any) => ({
              discussionid: x.discussions?.[0] ?? x.id,
              tieu_de: x.name,
              tac_gia: x.userfullname,
              tao_luc: fmtTime(x.timecreated),
              cap_nhat: fmtTime(x.timemodified),
              so_bai: x.numreplies,
              noi_dung: truncate(stripHtml(x.message ?? x.discussionmessage ?? ""), 600),
            })),
          };
        });
        return { courseid: c.id, mon: c.fullname, forums: discussions };
      });

      const out = results.filter(Boolean);
      return { content: [{ type: "text", text: safeStringify({ hoc_ky: current?.code ?? null, ket_qua: out }) }] };
    },
  );

  server.registerTool(
    "get_forum_discussions",
    {
      title: "Chi tiết diễn đàn",
      description: "Lấy danh sách thảo luận của một forum cụ thể (forumid lấy từ list_announcements hoặc get_course_contents).",
      inputSchema: {
        forumid: z.number().int(),
        page: z.number().int().min(1).optional(),
        perpage: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ forumid, page, perpage }) => {
      const api = getApi();
      const d: any = await api.call("mod_forum_get_forum_discussions", {
        forumid,
        page: page ?? 1,
        perpage: perpage ?? 20,
      });
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              forumid,
              tong: (d.discussions ?? []).length,
              thao_luan: (d.discussions ?? []).map((x: any) => ({
                discussionid: x.id,
                tieu_de: x.name,
                tac_gia: x.userfullname,
                tao_luc: fmtTime(x.timecreated),
                so_bai: x.numreplies,
                noi_dung: stripHtml(x.message ?? ""),
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "download_file",
    {
      title: "Tải file từ elearning",
      description:
        "Tải một file (slide, đề bài, bài nộp...) từ elearning.tdtu.edu.vn về máy. Nhận fileurl lấy từ get_course_contents / list_assignments / get_submission_status.",
      inputSchema: {
        fileurl: z.string().describe("URL file (pluginfile hoặc https thường)"),
        dest: z.string().optional().describe("Đường dẫn đích. Bỏ trống = lưu vào ~/Downloads/tdtu-mcp"),
      },
    },
    async ({ fileurl, dest }) => {
      const api = getApi();
      const r = await api.downloadFile(fileurl, dest);
      return { content: [{ type: "text", text: safeStringify({ thanh_cong: true, ...r }) }] };
    },
  );

  server.registerTool(
    "get_file_link",
    {
      title: "Lấy link tải có token",
      description: "Bọc URL pluginfile của elearning kèm token để mở trực tiếp trên trình duyệt (hết hạn khi token đổi).",
      inputSchema: { fileurl: z.string() },
    },
    async ({ fileurl }) => {
      const url = await getApi().withToken(fileurl);
      return { content: [{ type: "text", text: safeStringify({ url }) }] };
    },
  );
}
