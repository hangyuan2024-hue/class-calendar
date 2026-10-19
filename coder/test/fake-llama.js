#!/usr/bin/env node
// 测试用的「llama-server」：/health、/v1/chat/completions（流式），回答里带上收到的报错，方便检查提示词
const http = require("http");
const port = +process.argv[process.argv.indexOf("--port") + 1] || 18096;
http.createServer((req, res) => {
  if (req.url === "/health") { res.end('{"status":"ok"}'); return; }
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const j = JSON.parse(b || "{}"), last = (j.messages || []).slice(-1)[0] || {};
    require("fs").writeFileSync(process.env.LC_FAKE_LOG || "/tmp/lc-fake-llama.json", JSON.stringify(j));
    const hasErr = /【报错】/.test(last.content), line = (last.content.match(/第 (\d+) 行/) || [])[1];
    const text = hasErr ? `**第 ${line} 行**少了分号。在 \`int n\` 后面加一个 \`;\`：\n\n\`\`\`c\nint n;\n\`\`\`\n\n- 每条语句都要用分号结尾\n- 改完再按 F5 试试` : "你好！我是捞捞，有什么不懂的尽管问。";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const parts = text.match(/[\s\S]{1,6}/g); let i = 0;
    const t = setInterval(() => { if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`); else { res.write("data: [DONE]\n\n"); res.end(); clearInterval(t); } }, 15);
  });
}).listen(port, "127.0.0.1");
