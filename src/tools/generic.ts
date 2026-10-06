import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi } from "../state.js";
import { safeStringify } from "../util.js";

/**
 * Gợi ý tham số cho các function thường dùng.
 * (Moodle 3.8 không expose schema của WS function qua API nên ta tự ghi lại.)
 */
const HINTS: Record<string, string> = {
  core_webservice_get_site_info: "() không có tham số",
  core_enrol_get_users_courses: "{ userid } — userid lấy từ whoami",
  core_course_get_courses: "{ options?: [{name,value}] }",
  core_course_get_contents: "{ courseid }",
  core_course_get_categories: "{ }",
  core_course_search_courses: "{ criterianame: 'all'|'shortname'|'fullname'|'summary', criteriavalue, page?, perpage? }",
  core_course_get_courses_by_field: "{ field?, value? }",
  core_course_get_recent_courses: "{ userid }",
  core_enrol_get_enrolled_users: "{ courseid } (cần quyền)",
  core_enrol_get_course_enrolment_methods: "{ courseid }",
  core_calendar_get_action_events_by_timesort: "{ timesortfrom, timesortto } — KHÔNG có param limit",
  core_calendar_get_action_events_by_courses: "{ courseids: [id,...], timesortfrom?, timesortto? }",
  core_calendar_get_calendar_events: "{ courseids: [id] }",
  core_calendar_get_calendar_upcoming_view: "{ courseids?: [id] }",
  core_completion_get_activities_completion_status: "{ courseid, userid }",
  core_completion_get_course_completion_status: "{ courseid, userid? }",
  core_user_get_users_by_field: "{ field: 'username'|'id'|'email', values: ['52300024'] }",
  core_user_get_user_preferences: "{ userid? }",
  core_message_get_conversations: "{ userid, type: 'private'|'public'|'starred', limit?, offset? }",
  core_message_send_instant_messages: "{ messages: [{ touserid, text, textformat: 1 }] }",
  message_popup_get_popup_notifications: "{ useridto }",
  mod_assign_get_assignments: "{ courseids: [id,...] }",
  mod_assign_get_submission_status: "{ assignid, userid?, groupid? }",
  mod_assign_save_submission:
    "{ assignmentid, plugindata: { files_filemanager?: <draft itemid>, onlinetext_editor?: { text, format: 1, itemid: 0 } } }",
  mod_assign_submit_for_grading: "{ assignmentid, acceptsubmissionstatement: true }",
  mod_assign_get_grades: "{ assignmentids: [id,...] } (cần quyền GV)",
  mod_assign_get_submissions: "{ assignmentids: [id,...] } (cần quyền GV)",
  mod_assign_save_grade: "{ assignmentid, userid, grade, attemptnumber, addattempt, workflowstate?, applytoall, ... } (GV)",
  mod_forum_get_forums_by_courses: "{ courseids: [id,...] }",
  mod_forum_get_forum_discussions: "{ forumid, page?, perpage? }",
  mod_forum_get_discussion_posts: "{ discussionid }",
  mod_forum_add_discussion: "{ forumid, subject, message, messageformat? }",
  mod_forum_add_discussion_post: "{ discussionid, subject, message, messageformat? }",
  mod_quiz_get_quizzes_by_courses: "{ courseids: [id,...] }",
  mod_quiz_get_quiz_access_information: "{ quizid }",
  mod_quiz_get_attempt_access_information: "{ quizid }",
  mod_quiz_get_user_attempts: "{ quizid, attempt?, state? }",
  mod_quiz_get_user_best_grade: "{ quizid }",
  mod_quiz_start_attempt: "{ quizid } — HÀM GHI, sẽ mở attempt thật",
  mod_quiz_get_attempt_data: "{ attemptid }",
  mod_quiz_get_attempt_review: "{ attemptid, page? }",
  mod_quiz_save_attempt: "{ attemptid, data: [{ name: '<quiz_layout_field>', value: '...' }] } — HÀM GHI",
  mod_quiz_process_attempt: "{ attemptid, ... } — HÀM GHI, nộp attempt",
  mod_resource_get_resources_by_courses: "{ courseids: [id,...] }",
  mod_page_get_pages_by_courses: "{ courseids: [id,...] }",
  mod_book_get_books_by_courses: "{ courseids: [id,...] }",
  gradereport_user_get_grade_items: "{ courseid, userid? }",
  gradereport_overview_get_course_grades: "{ userid }",
  block_starredcourses_get_starred_courses: "{ userid }",
  webservice_upload: "Dùng tool submit_assignment hoặc uploadFile — gọi POST /webservice/upload.php với param `token`",
};

const WRITE_HINT = [
  "mod_assign_save_submission",
  "mod_assign_submit_for_grading",
  "mod_assign_save_grade",
  "mod_forum_add_discussion",
  "mod_forum_add_discussion_post",
  "mod_quiz_start_attempt",
  "mod_quiz_save_attempt",
  "mod_quiz_process_attempt",
  "mod_choice_submit_choice_response",
  "core_message_send_instant_messages",
  "core_course_set_favourite_courses",
];

export function registerGenericTools(server: McpServer): void {
  server.registerTool(
    "moodle_functions",
    {
      title: "Danh sách webservice function",
      description:
        "Liệt kê toàn bộ webservice function mà elearning.tdtu.edu.vn cho phép gọi (dùng chung với moodle_call). Có thể lọc theo từ khóa. Kèm gợi ý tham số cho các hàm thường dùng.",
      inputSchema: {
        query: z.string().optional().describe("Lọc theo tiền tố/từ khóa, vd: 'mod_assign' hoặc 'core_course'"),
        chi_goi_y: z.boolean().optional().describe("true = chỉ hiện các hàm có gợi ý tham số"),
      },
    },
    async ({ query, chi_goi_y }) => {
      const api = getApi();
      const fns = await api.functions();
      let out = fns;
      if (query) {
        const q = query.toLowerCase();
        out = out.filter((f) => f.toLowerCase().includes(q));
      }
      const hints = out.filter((f) => HINTS[f]);
      const list = chi_goi_y ? hints : out;
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              tong: fns.length,
              hien_thi: list.length,
              ghi_chu:
                "Moodle không expose schema của function; dùng HINTS (nếu có) hoặc đọc lỗi validate mà server trả về để biết tên tham số đúng.",
              goi_y: hints.length ? Object.fromEntries(hints.map((f) => [f, HINTS[f]])) : undefined,
              danh_sach: list,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "moodle_call",
    {
      title: "Gọi bất kỳ webservice function nào",
      description:
        "Gọi TRỰC TIẾP một webservice function của Moodle bằng tên + params (JSON object). Đây là cửa thoát để dùng đủ 368 function của elearning (tin nhắn, ghi danh, đánh giá, wiki, workshop, SCORM...). Nếu lỗi validate, server sẽ báo tên tham số thiếu/sai — sửa lại params rồi gọi tiếp.",
      inputSchema: {
        wsfunction: z.string().describe("Tên function, vd: 'mod_forum_get_forums_by_courses'"),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe('Object tham số, vd: {"courseids":[55446]}. Mảng/lồng nhau đều được.'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ wsfunction, params }) => {
      const api = getApi();
      const available = await api.functions();
      if (!available.includes(wsfunction)) {
        const near = available.filter((f) => f.includes(wsfunction.split("_").slice(0, 2).join("_"))).slice(0, 15);
        return {
          content: [
            {
              type: "text",
              text: safeStringify({
                loi: `"${wsfunction}" không tồn tại hoặc site không bật cho tài khoản này.`,
                goi_y_gan_dung: near,
                tong_function_kha_dung: available.length,
              }),
            },
          ],
          isError: true,
        };
      }
      const data = await api.call(wsfunction, params ?? {});
      const isBig = JSON.stringify(data).length > 200000;
      return {
        content: [
          {
            type: "text",
            text: isBig
              ? JSON.stringify({ ghi_chu: "Phản hồi rất lớn, đã cắt gọn", data: String(data).slice(0, 200000) }, null, 2)
              : safeStringify(data),
          },
        ],
      };
    },
  );

  server.registerTool(
    "moodle_hints",
    {
      title: "Gợi ý tham số",
      description: "Xem gợi ý tham số đã biết cho một webservice function cụ thể.",
      inputSchema: { wsfunction: z.string() },
    },
    async ({ wsfunction }) => {
      return {
        content: [
          {
            type: "text",
            text: safeStringify({
              wsfunction,
              goi_y: HINTS[wsfunction] ?? "Chưa có gợi ý — thử gọi với params rỗng, đọc lỗi 'Missing required key' để biết tên tham số.",
              la_ham_ghi: WRITE_HINT.includes(wsfunction),
            }),
          },
        ],
      };
    },
  );
}
