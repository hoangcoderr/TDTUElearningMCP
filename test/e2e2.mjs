import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

const client = new Client({ name: "test2", version: "0.0.1" });
const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env }, stderr: "pipe" });
transport.stderr?.on("data", (d) => process.stderr.write("[srv] " + d));
await client.connect(transport);

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c) => c.text).join("");
  console.log(`\n===== ${name} ${r.isError ? "[ERROR]" : ""} =====`);
  console.log(text.length > 2500 ? text.slice(0, 2500) + `\n... (${text.length} bytes)` : text);
  return text;
}

fs.writeFileSync("/tmp/opencode/lab5_note.txt", "Ghi chu test MCP - chua nop that. Xoan file nay neu can.\n");

await call("search_courses", { query: "bảo mật" });
await call("get_completion", { courseid: 55446 });
await call("list_messages", {});
await call("get_quiz_info", { quizid: 95356 });
await call("get_file_link", { fileurl: "https://elearning.tdtu.edu.vn/webservice/pluginfile.php/1821108/mod_assign/introattachment/0/examples.py" });
const dl = await call("download_file", { fileurl: "https://elearning.tdtu.edu.vn/webservice/pluginfile.php/1821108/mod_assign/introattachment/0/examples.py" });
console.log("file tải về tồn tại:", fs.existsSync(JSON.parse(dl.match(/\{[\s\S]*\}/)[0]).path));

await call("moodle_call", { wsfunction: "mod_forum_get_forums_by_courses", params: { courseids: [55446] } });

console.log("\n\n#### live submit draft test (không nộp thật) ####");
await call("submit_assignment", { assignid: 218861, files: ["/tmp/opencode/lab5_note.txt"], submit: false });
await call("get_submission_status", { assignid: 218861 });

await client.close();
process.exit(0);
