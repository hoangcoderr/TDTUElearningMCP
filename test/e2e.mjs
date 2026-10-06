import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "test", version: "0.0.1" });
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "pipe",
});
transport.stderr?.on("data", (d) => process.stderr.write("[srv] " + d));

await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS (" + tools.length + "):");
for (const t of tools) console.log("  -", t.name);

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c) => c.text).join("");
  console.log(`\n===== ${name} ${JSON.stringify(args ?? {})} ${r.isError ? "[ERROR]" : ""} =====`);
  console.log(text.length > 3000 ? text.slice(0, 3000) + `\n... (${text.length} bytes)` : text);
  return { isError: !!r.isError, text };
}

const which = process.argv[2] ?? "all";

if (which === "all" || which === "whoami") await call("whoami");
if (which === "all" || which === "courses") await call("list_courses", { semester: "HK1_2026" });
if (which === "all" || which === "sem") await call("get_current_semester");
if (which === "all" || which === "contents") await call("get_course_contents", { courseid: 55446, loai: "nop_bai" });
if (which === "all" || which === "bytype") await call("list_content_by_type", { loai: "nop_bai", gioi_han: 15 });
if (which === "all" || which === "assign") await call("list_assignments", { voi_trang_thai_nop: true, trang_thai: "con_han" });
if (which === "all" || which === "sub") await call("get_submission_status", { assignid: 218861 });
if (which === "all" || which === "dead") await call("get_upcoming_deadlines", { ngay: 30 });
if (which === "all" || which === "grades") await call("get_grades");
if (which === "all" || which === "quiz") await call("list_quizzes");
if (which === "all" || which === "ann") await call("list_announcements", { courseid: 55446, gioi_han: 3 });
if (which === "all" || which === "notif") await call("list_notifications");
if (which === "all" || which === "gen") await call("moodle_functions", { query: "mod_assign" });
if (which === "all" || which === "call") await call("moodle_call", { wsfunction: "core_course_get_categories", params: {} });
if (which === "all" || which === "badcall") await call("moodle_call", { wsfunction: "core_khong_ton_tai", params: {} });

await client.close();
process.exit(0);
