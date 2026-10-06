# TDTU eLearning MCP

MCP server (stdio) cho **elearning.tdtu.edu.vn** (Moodle 3.8). Cho phép trợ lý AI
truy cập và thao tác với tài nguyên học tập của bạn: xem môn học, nội dung, hạn nộp,
bài đã nộp, điểm, lịch học, thông báo và **nộp bài / làm quiz**.

## Tính năng

- **Tài khoản**: `whoami` — thông tin sinh viên và tài khoản.
- **Môn học**: `list_courses`, `get_current_semester`, `search_courses`.
- **Nội dung môn**: `get_course_contents`, `list_content_by_type`
  (tài liệu / liên kết / bài nộp / quiz / thông báo).
- **Diễn đàn**: `list_announcements`, `get_forum_discussions`.
- **Bài tập**: `list_assignments`, `get_submission_status`, `submit_assignment`,
  `get_assignment_detail`.
- **Deadline / lịch**: `get_upcoming_deadlines`.
- **Học tập khác**: `get_grades`, `get_completion`.
- **Quiz**: `list_quizzes`, `get_quiz_info`, `start_quiz_attempt`, `get_quiz_attempt`.
- **Trao đổi**: `list_notifications`, `list_messages`.
- **File**: `download_file`, `get_file_link`.
- **Toàn bộ webservice**: `moodle_functions`, `moodle_call`, `moodle_hints`
  (đủ 368 function mà site cho phép).

## Yêu cầu

- Node.js >= 18 (khuyến nghị 22+)
- Tài khoản elearning.tdtu.edu.vn đã được kích hoạt webservice mobile
  (site đã bật sẵn, sinh viên dùng được ~368 function).

## Cài đặt

```bash
git clone https://github.com/hoangcoderr/TDTUElearningMCP.git
cd TDTUElearningMCP
npm install
npm run build
```

(Hoặc chạy `./setup.sh` để install + build tự động.)

## Cấu hình

Server đọc cấu hình từ biến môi trường:

| Biến | Bắt buộc | Mặc định | Mô tả |
| --- | --- | --- | --- |
| `TDTU_MSSV` | ✅ | — | Mã số sinh viên |
| `TDTU_PASSWORD` | ✅ | — | Mật khẩu |
| `TDTU_ELEARNING_URL` | | `https://elearning.tdtu.edu.vn` | Địa chỉ site |
| `TDTU_DOWNLOAD_DIR` | | `~/Downloads/tdtu-mcp` | Nơi lưu file tải về |
| `TDTU_TIMEOUT_MS` | | `60000` | Timeout HTTP |

Bạn có thể đặt vào file `.env` (đã được `.gitignore`):

```bash
cp .env.example .env
# sửa TDTU_MSSV và TDTU_PASSWORD
```

Khi chạy, server sẽ load `.env` tự động? Bạn cần tự export. Cách đơn giản:

```bash
export $(grep -v '^#' .env | xargs)
```

## Chạy thử

```bash
node dist/index.js --version          # in version
node dist/index.js --help             # xem biến môi trường
TDTU_MSSV=your_mssv TDTU_PASSWORD=*** node dist/index.js
```

Log sẽ in ra stderr; MCP giao tiếp JSON qua stdout.

## Kết nối với AI client

Tất cả client đều dùng chung 1 cách: chạy `node dist/index.js` và truyền env
`TDTU_MSSV` + `TDTU_PASSWORD`. Thư mục `configs/` có mẫu cho từng client —
bạn chỉ cần sửa đường dẫn tuyệt đối tới `dist/index.js` và điền thông tin đăng nhập.

### Claude Code (CLI)
Tạo file `.mcp.json` ở gốc dự án (project-scope):

```bash
cat > .mcp.json <<'JSON'
{
  "mcpServers": {
    "tdtu-elearning": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/PATH/TO/tdtu-mcp/dist/index.js"],
      "env": {
        "TDTU_MSSV": "your_student_id",
        "TDTU_PASSWORD": "your_password"
      }
    }
  }
}
JSON
```

Hoặc thêm bằng CLI (user-scope):

```bash
claude mcp add tdtu-elearning --scope user \
  -e TDTU_MSSV=your_student_id \
  -e TDTU_PASSWORD=your_password \
  -- node /ABS/PATH/TO/tdtu-mcp/dist/index.js
```

### Codex
Sửa `~/.codex/config.toml`, thêm:

```toml
[mcp_servers.tdtu-elearning]
command = "node"
args = ["/ABS/PATH/TO/tdtu-mcp/dist/index.js"]
env = { TDTU_MSSV = "your_student_id", TDTU_PASSWORD = "your_password" }
```

### OpenCode
Sửa `~/.config/opencode/opencode.json` (tạo mới nếu chưa có):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tdtu-elearning": {
      "type": "local",
      "command": ["node", "/ABS/PATH/TO/tdtu-mcp/dist/index.js"],
      "environment": {
        "TDTU_MSSV": "your_student_id",
        "TDTU_PASSWORD": "your_password"
      },
      "enabled": true
    }
  }
}
```

### Claude Desktop
Sửa `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tdtu-elearning": {
      "command": "node",
      "args": ["/ABS/PATH/TO/tdtu-mcp/dist/index.js"],
      "env": {
        "TDTU_MSSV": "your_student_id",
        "TDTU_PASSWORD": "your_password"
      }
    }
  }
}
```

### Cursor
Sửa `~/.cursor/mcp.json` (hoặc `.cursor/mcp.json` trong workspace) — cùng schema
với Claude Code (`mcpServers`).

### VS Code
Tạo `.vscode/mcp.json` trong workspace:

```json
{
  "servers": {
    "tdtu-elearning": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/PATH/TO/tdtu-mcp/dist/index.js"],
      "env": {
        "TDTU_MSSV": "your_student_id",
        "TDTU_PASSWORD": "your_password"
      }
    }
  }
}
```

Mọi chỗ `/ABS/PATH/TO/tdtu-mcp` thay bằng đường dẫn thực tế của thư mục project.
Sau khi sửa config, khởi động lại client (hoặc chạy `/mcp` trong Claude Code /
OpenCode) để client nhận lại danh sách tool.

## Cách dùng nhanh

Vài prompt gợi ý sau khi dán config vào Cursor/VSCode/Claude:

- "Liệt kê các môn tôi đang học ở HK1_2026 và những bài tập còn hạn."
- "Cho tôi xem toàn bộ bài nộp chưa nộp trong môn Bảo mật máy tính."
- "Tải về file PDF đề bài của assignment Lab5."
- "Xem điểm của tôi ở các môn học kỳ này."
- "Nộp bài cho assignment 218861 với file /path/to/lab5.zip."

## Danh sách tool

| Tool | Mô tả |
| --- | --- |
| `whoami` | Thông tin tài khoản, số function khả dụng |
| `list_courses` | DS môn học (lọc `semester`, `search`) |
| `get_current_semester` | Học kỳ hiện tại + các môn + bài tập mở |
| `search_courses` | Tìm kiếm môn học toàn trường |
| `get_course_contents` | Nội dung môn, lọc theo loại (`tai_lieu`, `nop_bai`, …) |
| `list_content_by_type` | Gom nội dung theo loại ở nhiều môn |
| `list_announcements` / `get_forum_discussions` | Thông báo & diễn đàn |
| `list_assignments` | DS bài nộp (lọc theo hạn và trạng thái) |
| `get_submission_status` | Trạng thái bài đã nộp, file, điểm |
| `submit_assignment` | Nộp bài (file / online text), `submit` để nộp chính thức |
| `get_assignment_detail` | Mô tả, file đính kèm, hạn nộp |
| `get_upcoming_deadlines` | Hạn nộp + sự kiện lịch trong N ngày |
| `get_grades` | Bảng điểm (1 môn hoặc tổng hợp) |
| `get_completion` | Tiến độ hoàn thành từng hoạt động |
| `list_quizzes` / `get_quiz_info` / `start_quiz_attempt` / `get_quiz_attempt` | Quiz |
| `list_notifications` / `list_messages` | Thông báo hệ thống / tin nhắn |
| `download_file` / `get_file_link` | Tải file hoặc lấy URL kèm token |
| `moodle_functions` | Liệt kê toàn bộ webservice function khả dụng |
| `moodle_call` | Gọi function bất kỳ theo tên + params |
| `moodle_hints` | Gợi ý tham số cho các function thường dùng |

## Lưu ý nộp bài & quiz

- **Moodle TDTU đang tắt chế độ nháp (`submissiondrafts=0`)**:
  `submit_assignment` với `submit=false` vẫn sẽ tạo bài ở trạng thái `submitted`.
  Dùng `submit=true` để chắc chắn gọi submit for grading.
- `submit_assignment` tự kiểm tra `submissionsenabled`/`locked`: nếu bài đã đóng
  hoặc khoá sẽ báo rõ lý do.
- `start_quiz_attempt` mở attempt thật và **bị tính vào giới hạn số lần làm** —
  chỉ dùng khi bạn chủ động muốn làm bài.

## Bảo mật

- File token cache: `~/.config/tdtu-mcp/token.json` (quyền `0600`) — chỉ lưu webservice token.
- Không commit `.env`, token cache hay bất kỳ file chứa mật khẩu nào.
- Token hết hạn → tool tự đăng nhập lại (cache bị xoá rồi login lại).

## Khắc phục sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `Lỗi đăng nhập` | Sai MSSV/mật khẩu hoặc user disabled | Kiểm tra `whoami` trước; đặt lại mật khẩu trên site |
| `Unexpected keys` từ Moodle | Gọi function sai tên tham số | Dùng `moodle_hints` hoặc đọc `Chi tiết` trong tool result |
| `No permission` | Function yêu quyền giảng viên | VD: `mod_assign_get_submissions`, `mod_assign_save_grade` |
| Upload thất bại | File quá lớn hoặc không hỗ trợ `filearea=draft` | Kiểm tra dung lượng, thử `mod_assign_save_submission` qua `moodle_call` |
| Mất kết nối | Mạng hoặc site bảo trì | Kiểm tra `TDTU_ELEARNING_URL`, bật lại khi site back |

## Cấu trúc dự án

```
tdtu-mcp/
├── src/
│   ├── index.ts            # entry point, connect stdio
│   ├── config.ts           # env + token cache
│   ├── moodle.ts           # MoodleApi client
│   ├── state.ts            # singleton + cache
│   ├── util.ts             # semester detect, formatters
│   └── tools/
│       ├── courses.ts
│       ├── content.ts
│       ├── assignments.ts
│       ├── academics.ts
│       └── generic.ts
├── dist/                   # build output
├── test/                   # e2e scripts (cần env thật)
├── configs/                # config mẫu cho client
├── .env.example
└── README.md
```

## Scripts

```bash
npm run build   # compile TypeScript -> dist/
npm test        # chạy script e2e (cần TDTU_MSSV/TDTU_PASSWORD)
node dist/index.js --help
```
