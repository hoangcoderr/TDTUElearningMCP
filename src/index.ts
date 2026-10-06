#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCourseTools } from "./tools/courses.js";
import { registerContentTools } from "./tools/content.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerAcademicTools } from "./tools/academics.js";
import { registerGenericTools } from "./tools/generic.js";
import { ConfigError, loadConfig } from "./config.js";
import { getApi } from "./state.js";

const VERSION = "0.1.0";

function log(msg: string): void {
  process.stderr.write(`[tdtu-mcp] ${msg}\n`);
}

const server = new McpServer({ name: "tdtu-elearning", version: VERSION });

registerCourseTools(server);
registerContentTools(server);
registerAssignmentTools(server);
registerAcademicTools(server);
registerGenericTools(server);

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "tdtu-mcp — MCP server cho elearning.tdtu.edu.vn (Moodle)",
        "",
        "Biến môi trường:",
        "  TDTU_MSSV      Mã số sinh viên (vd: your_student_id)",
        "  TDTU_PASSWORD  Mật khẩu",
        "  TDTU_ELEARNING_URL  (tùy chọn, mặc định https://elearning.tdtu.edu.vn)",
        "  TDTU_DOWNLOAD_DIR    (tùy chọn, nơi lưu file tải về)",
        "",
        "Chạy: TDTU_MSSV=... TDTU_PASSWORD=... node dist/index.js",
        "",
      ].join("\n"),
    );
    return;
  }
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    process.stdout.write(VERSION + "\n");
    return;
  }

  try {
    loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) log(`CẤU HÌNH THIẾU: ${e.message}`);
    else log(String(e));
    log("Server vẫn khởi động — các tool sẽ báo lỗi này cho tới khi bạn set env.");
  }

  // Kiểm tra đăng nhập trước, in log rõ ràng nếu hỏng (không chặn server vì MCP cần stdout).
  try {
    const api = getApi();
    const info = await api.siteInfo();
    const fns = await api.functions();
    log(`Đã đăng nhập ${info.fullname} (${info.username}) — ${fns.length} webservice function khả dụng.`);
  } catch (e: any) {
    log(`Không đăng nhập được: ${e?.message ?? e}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Sẵn sàng (stdio).");
}

process.on("uncaughtException", (e) => log(`uncaught: ${e.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`unhandled: ${String(e)}`));

main().catch((e) => {
  log(`Lỗi khởi động: ${e?.stack ?? e}`);
  process.exit(1);
});
