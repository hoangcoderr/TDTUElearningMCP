import fs from "node:fs";
import path from "node:path";
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
  parseSemester,
  safeStringify,
  semesterCourses,
  stripHtml,
  truncate,
} from "../util.js";
import { MoodleError } from "../moodle.js";

interface AssignRow {
  id: number;
  cmid: number;
  course: number;
  name: string;
  duedate: number;
  cutoffdate: number;
  allowsubmissionsfromdate: number;
  grade: number;
  intro?: string;
  introattachments?: any[];
  configs?: any[];
  _course?: string;
}

const STATUS_LABEL: Record<string, string> = {
  never: "Chưa nộp",
  draft: "Bản nháp",
  submitted: "Đã nộp",
  "": "—",
  noattempt: "Chưa làm",
  inprogress: "Đang làm",
  finished: "Đã nộp",
  reopened: "Đã mở lại",
};

function assignState(a: AssignRow, now = nowSec()): "chua_mo" | "con_han" | "het_han" | "het_han_nop" {
  if (a.allowsubmissionsfromdate && now < a.allowsubmissionsfromdate) return "chua_mo";
  if (a.cutoffdate && now >= a.cutoffdate) return "het_han_nop";
  if (a.duedate && now >= a.duedate) return "het_han";
  return "con_han";
}

async function fetchAssignments(courseids: number[]): Promise<AssignRow[]> {
  if (!courseids.length) return [];
  const api = getApi();
  const chunks: number[][] = [];
  for (let i = 0; i < courseids.length; i += 25) chunks.push(courseids.slice(i, i + 25));
  const results = await mapLimit(chunks, 3, async (ids) => {
    const data = await api.call("mod_assign_get_assignments", { courseids: ids }).catch(() => ({ courses: [] }));
    return (data.courses ?? []).flatMap((c: any) =>
      (c.assignments ?? []).map((a: any) => ({ ...a, _course: c.fullname } as AssignRow)),
    );
  });
  return results.flat();
}

export async function submissionStatus(assignid: number, userid?: number): Promise<any> {
  const api = getApi();
  return api.call("mod_assign_get_submission_status", { assignid, userid: userid ?? undefined });
}

function extractSubmittedFiles(status: any): any[] {
  const plugins: any[] = status?.lastattempt?.submission?.plugins ?? [];
  const files: any[] = [];
  for (const p of plugins) {
    for (const fa of p.fileareas ?? []) {
      for (const f of fa.files ?? []) files.push({ ...f, plugin: p.name });
    }
  }
  return files;
}

function briefStatus(status: any): any {
  const la = status?.lastattempt ?? {};
  const sub = la.submission ?? {};
  return {
    trang_thai: STATUS_LABEL[sub.status ?? ""] ?? sub.status,
    da_nop: sub.status === "submitted",
    cho_phep_nop: !!la.submissionsenabled,
    co_the_nop: !!la.cansubmit,
    da_khoa: !!la.locked,
    da_cham_diem: !!la.graded,
    tinh_trang_cham: la.gradingstatus,
    lan_sua_cuoi: fmtTime(sub.timemodified),
    files: extractSubmittedFiles(status).map((f) => ({ ten: f.filename, kich_thuoc: f.filesize, url: f.fileurl })),
    luu_y: la.cansubmit === false && la.locked === false && sub.status === "submitted" ? "Đã nộp, không thể sửa nữa." : undefined,
  };
}

export function registerAssignmentTools(server: McpServer): void {
  server.registerTool(
    "list_assignments",
    {
      title: "Danh sách bài tập (bài nộp)",
      description:
        "Liệt kê assignment (bài nộp) theo học kỳ hiện tại hoặc một môn, kèm hạn nộp, trạng thái còn hạn/hết hạn. Có thể lấy luôn trạng thái bài đã nộp của từng bài.",
      inputSchema: {
        courseid: z.number().int().optional().describe("Chỉ 1 môn. Bỏ trống = học kỳ hiện tại"),
        trang_thai: z
          .enum(["tat_ca", "con_han", "het_han", "chua_mo"])
          .optional()
          .describe("Lọc theo hạn nộp. Mặc định tat_ca"),
        voi_trang_thai_nop: z
          .boolean()
          .optional()
          .describe("Gọi thêm API xem từng bài đã nộp gì (chậm hơn, giới hạn 40 bài)"),
        gioi_han: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ courseid, trang_thai, voi_trang_thai_nop, gioi_han }) => {
      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      let targets = all;
      if (courseid) targets = all.filter((c) => c.id === courseid);
      else if (current) targets = semesterCourses(all, current);

      const assigns = await fetchAssignments(targets.map((c) => c.id));
      const now = nowSec();
      let rows = assigns.map((a) => ({ a, state: assignState(a, now) }));
      if (trang_thai && trang_thai !== "tat_ca") rows = rows.filter((r) => r.state === trang_thai);
      rows.sort((x, y) => (x.a.duedate || 1e12) - (y.a.duedate || 1e12));

      const limited = rows.slice(0, gioi_han ?? 100);
      let withStatus: any[] = limited.map(({ a, state }) => ({ a, state, st: null as any }));
      if (voi_trang_thai_nop) {
        withStatus = await mapLimit(limited, 5, async ({ a, state }) => {
          const st = await submissionStatus(a.id).catch(() => null);
          return { a, state, st };
        });
      }

      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              hoc_ky: current?.code ?? null,
              tong_mon: targets.length,
              tong_bai_tap: assigns.length,
              hien_thi: withStatus.length,
              bai_tap: withStatus.map(({ a, state, st }) => ({
                assignid: a.id,
                courseid: a.course,
                mon: a._course,
                ten_bai: a.name,
                han_nop: fmtTime(a.duedate),
                han_nop_cuoi: a.cutoffdate ? fmtTime(a.cutoffdate) : null,
                mo_nop_tu: fmtTime(a.allowsubmissionsfromdate),
                diem_toi_da: a.grade,
                tinh_trang: state,
                mo_ta: a.intro ? truncate(stripHtml(a.intro), 400) : null,
                file_dinh_kem: (a.introattachments ?? []).map((f: any) => ({ ten: f.filename, url: f.fileurl, size: f.filesize })),
                ...(st ? { nop_bai: briefStatus(st) } : {}),
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_submission_status",
    {
      title: "Xem bài đã nộp",
      description:
        "Xem trạng thái nộp bài của một assignment: đã nộp chưa, file nào, thời gian, có được chấm điểm chưa, có còn sửa được không.",
      inputSchema: {
        assignid: z.number().int().describe("ID assignment (lấy từ list_assignments hoặc get_course_contents)"),
        userid: z.number().int().optional().describe("Xem của user khác (chỉ làm được nếu có quyền)"),
      },
    },
    async ({ assignid, userid }) => {
      const st = await submissionStatus(assignid, userid);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              assignid,
              ...briefStatus(st),
              chi_tiet: st?.lastattempt?.submission
                ? {
                    submissionid: st.lastattempt.submission.id,
                    attemptnumber: st.lastattempt.submission.attemptnumber,
                    status: st.lastattempt.submission.status,
                  }
                : null,
              canh_bao: st?.warnings?.length ? st.warnings : undefined,
              plugin: st?.lastattempt?.submission?.plugins?.map((p: any) => ({
                ten: p.name,
                kieu: p.type,
                areas: (p.fileareas ?? []).map((fa: any) => ({
                  area: fa.area,
                  files: (fa.files ?? []).map((f: any) => ({
                    ten: f.filename,
                    size: f.filesize,
                    sua_luc: fmtTime(f.timemodified),
                    url: f.fileurl,
                  })),
                })),
                fields: p.fields,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "submit_assignment",
    {
      title: "Nộp bài tập",
      description:
        "Nộp bài cho assignment. Có thể nộp FILE (đường dẫn local), TEXT (nộp trực tuyến) hoặc cả hai. Mặc định chỉ LƯU BÀI (không gọi submit for grading); đặt submit=true để nộp thật. Lưu ý: site hiện tại tắt chế độ nháp (submissiondrafts=0) nên chỉ lưu cũng tương đương nộp cho GV. Luôn trả về trạng thái mới nhất.",
      inputSchema: {
        assignid: z.number().int().describe("ID assignment"),
        files: z.array(z.string()).optional().describe("Danh sách đường dẫn file cần nộp (tối đa số file mà môn cho phép)"),
        text: z.string().optional().describe("Nội dung nộp trực tuyến (online text)"),
        submit: z
          .boolean()
          .optional()
          .describe("true = nộp cho giảng viên (submit for grading). Mặc định false = chỉ lưu nháp"),
      },
    },
    async ({ assignid, files, text, submit }) => {
      const api = getApi();
      const before = await submissionStatus(assignid).catch(() => null);
      const la = before?.lastattempt;
      const canh_bao_truoc: string[] = [];
      if (la && la.submissionsenabled === false) {
        throw new MoodleError(
          "Bài này không nhận submission nữa (đã đóng/hết hạn). Không thể nộp.",
          "submissionsdisabled",
        );
      }
      if (la && la.locked) {
        throw new MoodleError("Bài này đã bị khoá, không thể nộp/sửa.", "locked");
      }
      if (la && la.cansubmit === false) {
        canh_bao_truoc.push("Moodle báo cansubmit=false — có thể đã quá hạn hoặc không cấp quyền. Vẫn thử nộp, lỗi sẽ hiển thị dưới.");
      }

      const plugindata: Record<string, unknown> = {};
      const uploaded: any[] = [];

      if (files?.length) {
        const abs = files.map((f) => path.resolve(f));
        for (const f of abs) if (!fs.existsSync(f)) throw new MoodleError(`Không tìm thấy file: ${f}`, "filenotfound");
        const itemid = Math.floor(Math.random() * 900_000_000) + 100_000_000;
        for (const f of abs) {
          const r = await api.uploadFile(f, { itemid, filearea: "draft" });
          uploaded.push({ ...r, path: f });
        }
        plugindata.files_filemanager = itemid;
      }

      if (text) {
        plugindata.onlinetext_editor = { text, format: 1, itemid: 0 };
      }

      const steps: string[] = [];
      if (Object.keys(plugindata).length) {
        try {
          await api.call("mod_assign_save_submission", { assignmentid: assignid, plugindata });
          steps.push("Đã lưu bài (save_submission).");
        } catch (e) {
          if (e instanceof MoodleError && /Unexpected keys/i.test(e.message)) {
            throw new MoodleError(
              "Môn này không bật loại submission bạn vừa gửi. " +
                (files?.length && text
                  ? "Thử nộp từng loại (chỉ file HOẶC chỉ text)."
                  : files?.length
                    ? "Chỉ hỗ trợ nộp text."
                    : "Chỉ hỗ trợ nộp file."),
              "plugindata_unsupported",
              e,
            );
          }
          throw e;
        }
      } else {
        steps.push("Không có dữ liệu mới để lưu (bạn chưa truyền files/text).");
      }

      let submitted = false;
      if (submit) {
        await api.call("mod_assign_submit_for_grading", { assignmentid: assignid, acceptsubmissionstatement: true });
        submitted = true;
        steps.push("Đã nộp cho giảng viên (submit for grading).");
      } else {
        steps.push(`Đã lưu bài (chưa gọi submit for grading). Lưu ý: site tắt draft, nên trạng thái thường là 'submitted'. Đặt submit=true nếu muốn nộp chính thức.`);
      }

      const after = await submissionStatus(assignid);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              assignid,
              da_nop_thuc: submitted,
              cac_buoc: steps,
              canh_bao: canh_bao_truoc.length ? canh_bao_truoc : undefined,
              file_da_upload: uploaded,
              trang_thai_moi: briefStatus(after),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_assignment_detail",
    {
      title: "Chi tiết bài tập",
      description: "Lấy mô tả đề bài, file đinh kèm của giảng viên, hạn nộp và trạng thái nộp của một assignment.",
      inputSchema: { assignid: z.number().int() },
    },
    async ({ assignid }) => {
      const all = await enrolledCourses();
      const current = detectCurrentSemester(all);
      const scope = current ? semesterCourses(all, current) : all;
      const assigns = await fetchAssignments(scope.map((c) => c.id));
      const a = assigns.find((x) => x.id === assignid);
      const st = await submissionStatus(assignid).catch(() => null);
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              assignid,
              found: !!a,
              ten_bai: a?.name,
              mon: a?._course,
              courseid: a?.course,
              de_bai: a?.intro ? stripHtml(a.intro) : null,
              han_nop: fmtDate(a?.duedate),
              han_nop_gio: fmtTime(a?.duedate),
              han_nop_cuoi: a?.cutoffdate ? fmtTime(a.cutoffdate) : null,
              mo_nop_tu: fmtTime(a?.allowsubmissionsfromdate),
              diem_toi_da: a?.grade,
              file_dinh_kem: (a?.introattachments ?? []).map((f) => ({
                ten: f.filename,
                size: f.filesize,
                url: f.fileurl,
              })),
              trang_thai_nop: st ? briefStatus(st) : null,
            }),
          },
        ],
      };
    },
  );
}
