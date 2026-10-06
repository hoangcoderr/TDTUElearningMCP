import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, cached } from "../state.js";
import { detectCurrentSemester, fmtTime, parseSemester, semesterCourses, safeStringify } from "../util.js";

export interface EnrolledCourse {
  id: number;
  fullname: string;
  shortname: string;
  visible: number;
  enrolledusercount?: number;
  lastaccess?: number;
  timemodified?: number;
}

const COURSE_TTL = 60_000;

async function enrolledCourses(): Promise<EnrolledCourse[]> {
  const api = getApi();
  return cached("courses", COURSE_TTL, async () => {
    const userid = await api.userId();
    return (await api.call("core_enrol_get_users_courses", { userid })) as EnrolledCourse[];
  });
}

export { enrolledCourses };

export function registerCourseTools(server: McpServer): void {
  server.registerTool(
    "whoami",
    {
      title: "Thông tin tài khoản",
      description:
        "Trả về thông tin tài khoản đang đăng nhập trên elearning.tdtu.edu.vn (tên, MSSV, site, số webservice function khả dụng). Dùng để kiểm tra kết nối.",
    },
    async () => {
      const api = getApi();
      const info = await api.siteInfo();
      const fns = await api.functions();
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              sitename: info.sitename,
              siteurl: info.siteurl,
              fullname: info.fullname,
              username: info.username,
              userid: info.userid,
              lang: info.lang,
              version: info.version,
              release: info.release,
              available_ws_functions: fns.length,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_courses",
    {
      title: "Danh sách môn học",
      description:
        "Liệt kê toàn bộ môn học mà sinh viên đang theo dõi trên elearning. Có thể lọc theo từ khóa hoặc học kỳ (vd: HK1_2026).",
      inputSchema: {
        search: z.string().optional().describe("Lọc nhanh theo tên môn (không phân biệt hoa thường)"),
        semester: z
          .string()
          .optional()
          .describe('Mã học kỳ, vd "HK1_2026". Bỏ trống = tất cả.'),
        limit: z.number().int().min(1).max(200).optional().describe("Giới hạn số môn trả về (mặc định 200)"),
      },
    },
    async ({ search, semester, limit }) => {
      const courses = await enrolledCourses();
      let out = courses;
      if (semester) out = out.filter((c) => parseSemester(c.fullname)?.code.toUpperCase() === semester.toUpperCase());
      if (search) {
        const q = search.toLowerCase();
        out = out.filter((c) => c.fullname.toLowerCase().includes(q) || (c.shortname ?? "").toLowerCase().includes(q));
      }
      const current = detectCurrentSemester(courses);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong: courses.length,
              hoc_ky_hien_tai: current?.code ?? null,
              ket_qua: out.slice(0, limit ?? 200).map((c) => ({
                id: c.id,
                ten_mon: c.fullname,
                hoc_ky: parseSemester(c.fullname)?.code ?? null,
                visible: c.visible === 1,
                so_nguoi_theo_hoc: c.enrolledusercount,
                lan_cuoi_truy_cap: fmtTime(c.lastaccess),
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_current_semester",
    {
      title: "Học kỳ hiện tại",
      description:
        "Phát hiện học kỳ hiện tại (từ tên môn, vd HK1_2026) và trả về danh sách môn của học kỳ đó kèm số lượng bài tập đang mở.",
    },
    async () => {
      const api = getApi();
      const courses = await enrolledCourses();
      const current = detectCurrentSemester(courses);
      if (!current) {
        return {
          content: [{ type: "text", text: safeStringify({ hoc_ky: null, ghi_chu: "Không tìm thấy tên học kỳ dạng HKx_yyyy trong danh sách môn." }) }],
        };
      }
      const inSemester = semesterCourses(courses, current);
      const ids = inSemester.map((c) => c.id);
      let assignments: any = { courses: [] };
      try {
        assignments = await api.call("mod_assign_get_assignments", { courseids: ids });
      } catch (e) {
        /* bỏ qua nếu không có bài tập */
      }
      const now = Math.floor(Date.now() / 1000);
      const allAssignments: any[] = (assignments.courses ?? []).flatMap((c: any) =>
        (c.assignments ?? []).map((a: any) => ({ ...a, _course: c.fullname })),
      );
      const open = allAssignments.filter((a) => (!a.duedate || a.duedate > now) && (!a.cutoffdate || a.cutoffdate > now));

      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              hoc_ky: current.code,
              so_mon: inSemester.length,
              so_bai_tap: allAssignments.length,
              bai_tap_con_han: open.length,
              mon_hoc: inSemester.map((c) => ({ id: c.id, ten_mon: c.fullname })),
              bai_tap_sap_het_han: open
                .sort((a, b) => (a.duedate || 1e12) - (b.duedate || 1e12))
                .slice(0, 20)
                .map((a) => ({
                  assignid: a.id,
                  ten_bai: a.name,
                  mon: a._course,
                  han_nop: fmtTime(a.duedate),
                })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_courses",
    {
      title: "Tìm môn học toàn trường",
      description: "Tìm kiếm môn học trên toàn site elearning (không giới hạn môn mình đã ghi danh).",
      inputSchema: {
        query: z.string().describe("Từ khóa tìm kiếm, vd: 'Bảo mật'"),
        page: z.number().int().min(1).optional(),
        perpage: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, page, perpage }) => {
      const api = getApi();
      const data = await api.call("core_course_search_courses", {
        criterianame: "all",
        criteriavalue: query,
        page: page ?? 1,
        perpage: perpage ?? 20,
      });
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong: data?.total ?? data?.courses?.length ?? 0,
              khoa_hoc: (data?.courses ?? []).map((c: any) => ({
                id: c.id,
                ten_mon: c.fullname,
                shortname: c.shortname,
                can_phan: c.canenrol ?? c.enrolledusercount,
              })),
            }),
          },
        ],
      };
    },
  );
}
