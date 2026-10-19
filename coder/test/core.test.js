// node test/core.test.js —— 进度和连续天数、账号同步合并、一键安装（用本机假镜像）、提示词、回答渲染
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { execSync } = require("child_process");
const { Progress, sync, dayKey } = require("../core/account");
const TC = require("../core/toolchains");
const { messages } = require("../core/tutor");
const ok = (s) => console.log("✓ " + s);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lcc-"));
(async () => {
  // 1. 进度、连续天数
  const p = new Progress(path.join(tmp, "p.json"));
  const day = (n) => new Date(Date.now() - n * 864e5);
  p.data.days[dayKey(day(1))] = { runs: 3, solved: 1 }; p.data.days[dayKey(day(2))] = { runs: 1, solved: 0 }; p.data.days[dayKey(day(4))] = { runs: 9, solved: 2 };
  assert.strictEqual(p.streak(), 2, "今天还没写：从昨天往前数");
  p.ran(); assert.strictEqual(p.streak(), 3);
  assert.strictEqual(p.solved("hello", "c"), true); assert.strictEqual(p.solved("hello", "python"), false);
  p.tried("aplusb", "c");
  const s = p.summary(); assert.strictEqual(s.solved, 1); assert.strictEqual(s.today.solved, 1); assert.ok(p.data.pending.some((x) => x.ns === "code_progress_v1" && x.k === "hello"));
  const p2 = new Progress(path.join(tmp, "p.json")); assert.strictEqual(p2.summary().solved, 1, "存到文件里了");
  ok("进度：连续天数（今天没写从昨天算）、做对一题、存盘");
  // 2. 合并账号里的：做对的不会被「没做对」盖掉；同一天取大的
  p.merge([{ ns: "code_progress_v1", k: "hello", v: { done: false, t: Date.now() + 1000 } }, { ns: "code_progress_v1", k: "fib", v: { done: true, lang: "c", t: 1 } }, { ns: "code_days_v1", k: dayKey(day(3)), v: { runs: 2, solved: 0 } }, { ns: "other_v1", k: "x", v: 1 }]);
  assert.ok(p.data.ex.hello.done && p.data.ex.fib.done); assert.strictEqual(p.streak(), 5, "别的电脑上那天写过，连起来了");
  ok("合并账号里的进度：做对的不会被盖掉，别的电脑上的天数连起来");
  // 3. 同步：先传再拉，只要编程的两类
  const pushed = [];
  const api = { session: async () => ({ access_token: "t" }), rpc: async (fn, a) => {
    if (fn === "udata_push") { pushed.push(...a.p); return { applied: a.p.length }; }
    if (fn === "udata_pull") return a.since === 0 ? { rows: [{ ns: "code_progress_v1", k: "gcd", v: { done: true, t: 5 } }, { ns: "habits_v1", k: "x", v: {} }], rev: 42, more: true } : { rows: [{ ns: "code_days_v1", k: "2020-01-01", v: { runs: 1, solved: 0 } }], rev: 50, more: false };
  } };
  const r = await sync(api, p);
  assert.ok(r.ok && pushed.length > 0 && p.data.pending.length === 0 && p.data.ex.gcd.done && p.data.rev === 50 && p.data.days["2020-01-01"]);
  assert.ok(pushed.every((x) => x.ns && x.k && typeof x.t === "number"));
  ok("同步：攒着的传上去、账号里的拉下来（分页、跳过别的数据）");
  // 4. 一键安装：本机假镜像（目录页 + 压缩包），第一个地址坏了换下一个
  const pkg = path.join(tmp, "pkg"); fs.mkdirSync(path.join(pkg, "go", "bin"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "go", "bin", "go"), "#!/bin/sh\necho fake go\n"); fs.writeFileSync(path.join(pkg, "go", "pad.bin"), Buffer.alloc(3 * 1024 * 1024, 7));
  execSync(process.platform === "win32" ? `tar -a -cf ../go.zip go` : `zip -qr ../go.zip go`, { cwd: pkg });
  const zip = fs.readFileSync(path.join(tmp, "go.zip"));
  const srv = http.createServer((q, s) => {
    if (q.url === "/index/") { s.end('<a href="go1.22.1.windows-amd64.zip">x</a> <a href="go1.23.10.windows-amd64.zip">y</a> <a href="go1.23.9.windows-amd64.zip">z</a>'); return; }
    if (q.url === "/index/go1.23.10.windows-amd64.zip") { s.writeHead(200, { "Content-Length": zip.length }); s.end(zip); return; }
    s.writeHead(404); s.end();
  }).listen(0);
  const port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const saved = TC.TOOLS.go;
  TC.TOOLS.go = { ...saved, minBytes: 1000, sources: [{ url: base + "/broken.zip" }, { index: base + "/index/", pattern: /go[\d.]+\.windows-amd64\.zip/g }] };
  const user = path.join(tmp, "tc"); const seen = [];
  await TC.install("go", user, (x) => seen.push(x.phase));
  assert.ok(TC.installed("go", user) && fs.existsSync(path.join(user, "go", "bin", "go")) && !fs.existsSync(path.join(user, ".tmp-go")));
  assert.ok(seen.includes("download") && seen.includes("extract") && seen.includes("done"));
  TC.TOOLS.go = saved; srv.close();
  ok("一键安装：坏地址自动换下一个、镜像目录里挑最新版本（1.23.10 > 1.23.9）、解压后去掉外层文件夹");
  // 5. 提示词：系统说明 + 代码带行号 + 报错 + 练习题；选中的代码只发选中的
  const m = messages("error", { lang: "C", file: "a.c", code: "int main(){\n  int x\n}", diags: [{ line: 2, message: "expected ';'" }], output: "", exercise: { title: "两数之和", desc: "输入两个整数" } }, "", [{ role: "user", content: "x".repeat(5000) }]);
  assert.strictEqual(m[0].role, "system"); const last = m[m.length - 1].content;
  assert.ok(/  2\|   int x/.test(last) && /第 2 行：expected/.test(last) && /两数之和/.test(last) && /哪一行错了/.test(last));
  assert.ok(m[1].content.length < 1700, "太长的历史被截短");
  const m2 = messages("explain", { lang: "C", code: "整个文件", selection: "printf(\"hi\");" }, "");
  assert.ok(/选中的代码/.test(m2[1].content) && !/整个文件/.test(m2[1].content));
  const m3 = messages("error", { lang: "C", code: '#include <stdio.h>\nint main(){\n  printf("hi")\n}', diags: [{ line: 3, message: "expected ';' before '}' token", hint: "第 3 行「printf(\"hi\")」的后面少了一个分号 ;", fix: { line: 3, ch: 14, endLine: 3, endCh: 14, text: ";" } }] }, "");
  assert.ok(/已经确定的问题和改法[\s\S]*改完这一行是：printf\("hi"\);/.test(m3[1].content), "改法要当成事实告诉模型");
  assert.strictEqual(require("../core/tutor").options("error").temperature < 0.3, true);
  ok("提示词：带行号的代码、报错、练习题；选中的只发选中部分；长历史截短");
  // 6. 回答渲染：先转义，不执行 HTML
  global.window = {}; require("../renderer/md.js");
  const h = window.MD.render("**粗** `x<y`\n\n```c\nif (a<b) {}\n```\n- 一\n- 二\n<img src=x onerror=alert(1)>");
  assert.ok(/<b>粗<\/b>/.test(h) && /<code>x&lt;y<\/code>/.test(h) && /if \(a&lt;b\)/.test(h) && /<ul><li>一<\/li><li>二<\/li><\/ul>/.test(h) && !/<img/.test(h));
  ok("回答渲染：粗体、代码、列表；HTML 一律转义");
  console.log("核心：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
