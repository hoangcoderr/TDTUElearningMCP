# tdtu-mcp

MCP server (stdio) cho **elearning.tdtu.edu.vn** (Moodle 3.8). Cho phép trợ lý AI:
- Xem danh sách môn học, môn theo học kỳ
- Xem nội dung môn học phân loại: tài liệu, liên kết, bài nộp, quiz, thông báo
- Xem hạn nộp sắp tới, thông báo, tin nhắn, điểm, tiến độ học tập
- Xem bài đã nộp, **nộp bài** (file/text, lưu nháp hoặc nộp thật)
- Làm quiz (bắt đầu attempt, xem câu hỏi)
- Gọi **bất kỳ** webservice function nào của site (đủ 368 function) qua `moodle_call`

## Cài đặt

```bash
cd tdtu-mcp
npm install
npm run build
```

## Chạy

```bash
TDTU_MSSV=52300024 TDTU_PASSWORD='***' node dist/index.js
```

Biến môi trường:
| Biến | Bắt buộc | Mặc định |
|---|---|---|
| `TDTU_MSSV` | ✅ | — |
| `TDTU_PASSWORD` | ✅ | — |
| `TDTU_ELEARNING_URL` | | `https://elearning.tdtu.edu.vn` |
| `TDTU_DOWNLOAD_DIR` | | `~/Downloads/tdtu-mcp` |
| `TDTU_TIMEOUT_MS` | | `60000` |

Token đăng nhập được cache ở `~/.config/tdtu-mcp/token.json` (chỉ lưu token,
không lưu mật khẩu) và tự refresh khi hết hạn.

## Dùng với AI client

Xem `configs/` để copy vào:
- `claude_desktop_config.json` → `~/.config/Claude/claude_desktop_config.json`
- `cursor_mcp.json` → `~/.cursor/mcp.json`
- `vscode_mcp.json` → `.vscode/mcp.json`
- `opencode.json` → `~/.config/opencode/opencode.json`

## Các tool chính

| Tool | Mô tả |
|---|---|
| `whoami` | Thông tin tài khoản |
| `list_courses` | DS môn học (lọc theo học kỳ/từ khóa) |
| `get_current_semester` | Học kỳ hiện tại + môn + bài tập mở |
| `search_courses` | Tìm môn toàn trường |
| `get_course_contents` | Nội dung môn, lọc theo loại |
| `list_content_by_type` | Gom nội dung theo loại ở mọi môn |
| `list_announcements` / `get_forum_discussions` | Thông báo & diễn đàn |
| `list_assignments` | DS bài nộp (lọc theo hạn) |
| `get_submission_status` | Xem bài đã nộp |
| `submit_assignment` | Nộp bài (file/text; site TẮT chế độ nháp nên lưu = submitted) |
| `get_upcoming_deadlines` | Hạn nộp sắp tới |
| `get_grades` | Bảng điểm |
| `list_quizzes` / `get_quiz_info` / `start_quiz_attempt` / `get_quiz_attempt` | Quiz |
| `list_notifications` / `list_messages` | Thông báo & tin nhắn |
| `get_completion` | Tiến độ hoàn thành môn |
| `download_file` / `get_file_link` | Tải/lấy link file |
| `moodle_functions` / `moodle_call` / `moodle_hints` | Gọi mọi WS function |

## Lưu ý

- Site bật webservice cho mobile (`moodle_mobile_app`) nên không cần cấp quyền admin.
- `submit_assignment` mặc định chỉ **lưu bài** (không gọi submit for grading). Lưu ý: site TẮT chế độ nháp nên lưu = bài đã nộp (trạng thái `submitted`). Đặt `submit=true` để gọi submit formally.

- Một số function yêu cầu quyền giảng viên (`mod_assign_get_submissions`, `mod_assign_save_grade`, …) — sinh viên không gọi được.
- Việc nộp bài/quiz ghi **dữ liệu thật** — hãy chắc chắn trước khi dùng.
