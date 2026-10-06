import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, cached } from "../state.js";
import { enrolledCourses } from "./courses.js";
import {
  detectCurrentSemester,
  fmtDate,
  fmtTime,
  mapLimit,
  nowSec,
  safeStringify,
  semesterCourses,
  stripHtml,
  truncate,
} from "../util.js";

export function registerAcademicTools(server: McpServer): void {
  server.registerTool(
    "get_grades",
    {
      title: "Bảng điểm",
      description: "Xem điểm của bản thân. Chỉ định courseid để xem 1 môn, bỏ trống để xem tổng hợp mọi môn.",
      inputSchema: {
        courseid: z.number().int().optional(),
      },
    },
    async ({ courseid }) => {
      const api = getApi();
      const userid = await api.userId();

      if (courseid) {
        const data = await api.call("gradereport_user_get_grade_items", { courseid, userid });
        const items = data?.usergrades?.[0]?.gradeitems ?? [];
        return {
          content: [
            {
              type: "text",
              text: safeStringify({
                courseid,
                diem: items.map((g: any) => ({
                  ten: g.itemname || "(không đặt tên)",
                  loai: `${g.itemtype}${g.itemmodule ? "/" + g.itemmodule : ""}`,
                  diem: g.grade,
                  diem_toi_da: g.gradeformatted ? g.range : g.range,
                  phan_tram: g.percentageformatted ?? g.percentage,
                  xep_loai: g.lettergrade,
                  sua_luc: fmtTime(g.timemodified),
                })),
              }),
            },
          ],
        };
      }

      const data = await api.call("gradereport_overview_get_course_grades", { userid });
      const grades = Array.isArray(data) ? data : (data?.grades ?? []);
      const all = await enrolledCourses();
      const nameById = new Map(all.map((c) => [c.id, c.fullname]));
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong_mon: grades.length,
              co_diem: grades.filter((g: any) => g.grade && g.grade !== "-").length,
              diem: grades.map((g: any) => ({
                courseid: g.courseid,
                mon: g.coursefullname ?? g.courseshortname ?? nameById.get(Number(g.courseid)) ?? null,
                diem: g.grade,
                diem_toi_da: g.rawgrade ?? null,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_upcoming_deadlines",
    {
      title: "Hạn nộp sắp tới",
      description: "Gộp hạn nộp assignment + sự kiện lịch học trong N ngày tới, sắp xếp theo thời gian.",
      inputSchema: {
        ngay: z.number().int().min(1).max(180).optional().describe("Số ngày tới (mặc định 30)"),
        courseid: z.number().int().optional().describe("Lọc theo 1 môn"),
        chi_bai_tap: z.boolean().optional().describe("true = chỉ lấy deadline assignment"),
      },
    },
    async ({ ngay, courseid, chi_bai_tap }) => {
      const api = getApi();
      const days = ngay ?? 30;
      const from = nowSec() - 86400;
      const to = nowSec() + days * 86400;

      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      let targets = current ? semesterCourses(all, current) : all;
      if (courseid) targets = all.filter((c) => c.id === courseid);

      const courseName = new Map(targets.map((c) => [c.id, c.fullname]));

      const deadlineTasks = (async () => {
        const chunks: number[][] = [];
        const ids = targets.map((c) => c.id);
        for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
        const parts = await mapLimit(chunks, 3, async (chunk) => {
          const d = await api.call("mod_assign_get_assignments", { courseids: chunk }).catch(() => ({ courses: [] }));
          return (d.courses ?? []).flatMap((c: any) => (c.assignments ?? []).map((a: any) => ({ ...a, _course: c.fullname })));
        });
        return parts
          .flat()
          .filter((a: any) => a.duedate > 0 && a.duedate >= from && a.duedate <= to && (!courseid || a.course === courseid));
      })();

      const eventTasks = chi_bai_tap
        ? Promise.resolve([])
        : api
            .call("core_calendar_get_action_events_by_timesort", { timesortfrom: from, timesortto: to })
            .then((d: any) => (d.events ?? []))
            .catch(() => []);

      const [assigns, events] = await Promise.all([deadlineTasks, eventTasks]);

      const rows = [
        ...assigns.map((a: any) => ({
          loai: "bai_nop",
          id: a.id,
          ten: a.name,
          courseid: a.course,
          mon: a._course,
          thoi_gian: fmtTime(a.duedate),
          unix: a.duedate,
          con_lai: humanize(a.duedate - nowSec()),
        })),
        ...events.map((e: any) => ({
          loai: "su_kien",
          id: e.id,
          ten: e.name,
          courseid: e.courseid ?? e.course?.id ?? null,
          mon: e.course?.fullname ?? courseName.get(e.courseid) ?? null,
          kieu: e.eventtype,
          thoi_gian: fmtTime(e.timestart),
          unix: e.timestart,
          con_lai: humanize((e.timestart ?? 0) - nowSec()),
        })),
      ].sort((x, y) => (x.unix || 0) - (y.unix || 0));

      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              khoang_thang: `từ ${fmtDate(from)} đến ${fmtDate(to)}`,
              hoc_ky: current?.code ?? null,
              tong: rows.length,
              su_kien: rows,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_quizzes",
    {
      title: "Danh sách bài kiểm tra (quiz)",
      description: "Liệt kê quiz theo học kỳ hiện tại hoặc một môn, kèm số câu hỏi, thời lượng, số lần làm.",
      inputSchema: {
        courseid: z.number().int().optional(),
      },
    },
    async ({ courseid }) => {
      const api = getApi();
      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      let targets = current ? semesterCourses(all, current) : all;
      if (courseid) targets = all.filter((c) => c.id === courseid);

      const results = await mapLimit(targets, 4, async (c) => {
        const d: any = await api.call("mod_quiz_get_quizzes_by_courses", { courseids: [c.id] }).catch(() => ({ quizzes: [] }));
        return (d.quizzes ?? []).map((q: any) => ({
          quizid: q.id,
          courseid: q.course,
          mon: c.fullname,
          ten: q.name,
          cau_hoi: q.numquestions,
          thoi_gian_lam_phut: q.timeclose && q.timeopen ? Math.round((q.timeclose - q.timeopen) / 60) : q.timelimit ? Math.round(q.timelimit / 60) : null,
          mo_luc: fmtTime(q.timeopen),
          dong_luc: fmtTime(q.timeclose),
          so_lan_lam: q.attempts,
          diem_toi_da: q.grade,
          mo_ta: truncate(stripHtml(q.intro), 500),
        }));
      });

      const flat = results.flat().sort((a, b) => (a.dong_luc || "9999").localeCompare(b.dong_luc || "9999"));
      return { content: [{ type: "text", text: safeStringify({ hoc_ky: current?.code ?? null, tong: flat.length, quizzes: flat }) }] };
    },
  );

  server.registerTool(
    "get_quiz_info",
    {
      title: "Thông tin quiz",
      description: "Xem điều kiện làm quiz (còn được làm không, luật), các lần đã làm và điểm cao nhất.",
      inputSchema: { quizid: z.number().int() },
    },
    async ({ quizid }) => {
      const api = getApi();
      const [access, attempts, best] = await Promise.all([
        api.call("mod_quiz_get_quiz_access_information", { quizid }).catch((e) => ({ error: String(e) })),
        api.call("mod_quiz_get_user_attempts", { quizid }).catch(() => ({ attempts: [] })),
        api.call("mod_quiz_get_user_best_grade", { quizid }).catch(() => null),
      ]);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              quizid,
              co_the_lam: access?.canattempt ?? null,
              xem_lai: access?.canreviewmyattempts ?? null,
              luat: access?.accessrules ?? [],
              luat_id: access?.activerulenames ?? [],
              diem_cao_nhat: best,
              so_lan_da_lam: (attempts?.attempts ?? []).length,
              cac_lan_lam: (attempts?.attempts ?? []).map((a: any) => ({
                attemptid: a.id,
                lan: a.attempt,
                trang_thai: a.state,
                bat_dau: fmtTime(a.timestart),
                ket_thuc: fmtTime(a.timefinish),
                diem: a.sumgrades,
                trang: a.state,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "start_quiz_attempt",
    {
      title: "Bắt đầu làm quiz",
      description:
        "BẮT ĐẦU một lần làm quiz thật (attempt). Chỉ dùng khi bạn chủ động muốn vào làm bài — số lần làm bị giới hạn bởi giảng viên. Sau khi gọi, dùng get_quiz_attempt để xem câu hỏi.",
      inputSchema: { quizid: z.number().int() },
    },
    async ({ quizid }) => {
      const api = getApi();
      const data = await api.call("mod_quiz_start_attempt", { quizid });
      const attempt = data?.attempt ?? data;
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              thanh_cong: true,
              attemptid: attempt?.id,
              lan: attempt?.attempt,
              trang_thai: attempt?.state,
              bat_dau: fmtTime(attempt?.timestart),
              luu_y: "Dùng get_quiz_attempt(attemptid) để xem câu hỏi; moodle_call('mod_quiz_process_attempt', ...) để nộp.",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_quiz_attempt",
    {
      title: "Xem chi tiết lần làm quiz",
      description: "Lấy dữ liệu câu hỏi/kết quả của một attempt (attemptid từ get_quiz_info hoặc start_quiz_attempt).",
      inputSchema: { attemptid: z.number().int() },
    },
    async ({ attemptid }) => {
      const api = getApi();
      const data = await api.call("mod_quiz_get_attempt_data", { attemptid }).catch(async (e) => {
        const rev = await api.call("mod_quiz_get_attempt_review", { attemptid }).catch(() => null);
        if (rev) return rev;
        throw e;
      });
      return { content: [{ type: "text", text: safeStringify(data) }] };
    },
  );

  server.registerTool(
    "list_notifications",
    {
      title: "Thông báo hệ thống",
      description: "Lấy popup notifications (thông báo chưa đọc) của tài khoản.",
      inputSchema: {},
    },
    async () => {
      const api = getApi();
      const userid = await api.userId();
      const data = await api.call("message_popup_get_popup_notifications", { useridto: userid });
      const list = data?.notifications ?? [];
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong: list.length,
              thong_bao: list.map((n: any) => ({
                id: n.id,
                tieu_de: n.subject,
                gui_tu: n.userfromfullname,
                luc: fmtTime(n.timecreated),
                noi_dung: truncate(stripHtml(n.fullmessage ?? n.smallmessage ?? ""), 400),
                url: n.contexturl,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_messages",
    {
      title: "Tin nhắn",
      description: "Lấy các hội thoại tin nhắn riêng trên elearning.",
      inputSchema: {
        gioi_han: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ gioi_han, offset }) => {
      const api = getApi();
      const userid = await api.userId();
      const data = await api.call("core_message_get_conversations", { userid });
      const convs = data?.conversations ?? [];
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong: convs.length,
              hoi_thoai: convs.map((c: any) => ({
                id: c.id,
                ten: c.name,
                chua_doc: c.unreadcount ?? c.unread,
                tin_moi_nhat: fmtTime(c.timelastmessage),
                thanh_vien: (c.members ?? []).map((m: any) => m.fullname ?? m.name),
                tin: (c.messages ?? []).slice(0, 10).map((m: any) => ({
                  tu: m.useridfrom,
                  luc: fmtTime(m.timecreated),
                  noi_dung: truncate(stripHtml(m.text ?? m.body ?? ""), 300),
                })),
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_completion",
    {
      title: "Tiến độ hoàn thành môn",
      description: "Xem các hoạt động đã/chưa hoàn thành của một môn (completion tracking).",
      inputSchema: { courseid: z.number().int() },
    },
    async ({ courseid }) => {
      const api = getApi();
      const userid = await api.userId();
      const data = await api.call("core_completion_get_activities_completion_status", { courseid, userid });
      const statuses = data?.statuses ?? [];
      const done = statuses.filter((s: any) => s.state === 1);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              courseid,
              tong: statuses.length,
              hoan_thanh: done.length,
              phan_tram: statuses.length ? Math.round((done.length / statuses.length) * 100) : 0,
              chi_tiet: statuses.map((s: any) => ({
                cmid: s.cmid,
                kieu: s.modname,
                instance: s.instance,
                trang_thai: s.state === 1 ? "xong" : s.state === 2 ? "bắt buộc" : "chưa",
                luc: fmtTime(s.timecompleted),
              })),
            }),
          },
        ],
      };
    },
  );
}

function humanize(delta: number): string {
  if (!Number.isFinite(delta)) return "";
  if (delta < 0) return "đã quá hạn";
  const d = Math.floor(delta / 86400);
  const h = Math.floor((delta % 86400) / 3600);
  const m = Math.floor((delta % 3600) / 60);
  if (d > 0) return `${d} ngày ${h} giờ nữa`;
  if (h > 0) return `${h} giờ ${m} phút nữa`;
  return `${m} phút nữa`;
}
