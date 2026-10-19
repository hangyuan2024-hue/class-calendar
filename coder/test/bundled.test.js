// node test/bundled.test.js —— 打包前在 Windows 上检查「安装包自带的」编译器和本地模型真的能用（GitHub Actions 里跑）
// 只用 resources/ 里的东西，不用电脑上装的。LC_TEST_AI=1 时还会真的启动本地模型问一句。
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { runOnce, Session } = require("../core/runner");
const { locate } = require("../core/langs");
const AI = require("../core/ai");
const RES = path.join(__dirname, "..", "resources");
const opt = { toolDirs: { bundled: path.join(RES, "toolchains") }, allowSystem: false, buildDir: fs.mkdtempSync(path.join(os.tmpdir(), "lcb-")) };
const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lcb-ws-")), "捞捞编程", "练习");   // 中文路径
fs.mkdirSync(ws, { recursive: true });
const ok = (s) => console.log("✓ " + s);
(async () => {
  for (const id of ["c", "cpp", "python"]) assert.ok(locate(id, opt.toolDirs, false), id + " 没打进安装包");
  const cases = {
    c: ["成绩.c", '#include <stdio.h>\nint main(){int a,b;printf("请输入：");scanf("%d %d",&a,&b);printf("和是%d\\n",a+b);return 0;}\n'],
    cpp: ["你好.cpp", '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;vector<int> v{a,b};sort(v.begin(),v.end());cout<<"和是"<<a+b<<endl;}\n'],
    python: ["第一个.py", 'a, b = map(int, input("请输入：").split())\nprint(f"和是{a+b}")\n'],
  };
  for (const [id, [name, code]] of Object.entries(cases)) {
    const f = path.join(ws, name); fs.writeFileSync(f, code);
    const r = await runOnce(id, f, opt, "3 4\n", { timeoutMs: 30000 });
    assert.ok(!r.compileFailed, id + " 编译失败：" + (r.stderr || ""));
    assert.match(r.stdout, /和是7/, id + " 输出不对：" + JSON.stringify(r));
    // 交互：提示要马上显示（不用等程序结束）
    const s = new Session(); let out = "", prompt = false;
    if (id !== "cpp") await new Promise((res) => s.start(id, f, opt, { phase() {}, diags() {}, out(st, t) { if (st !== "compile") out += t; if (!prompt && /请输入/.test(out)) { prompt = true; s.input("5 6\n"); } }, exit: res }));
    if (id !== "cpp") assert.ok(prompt && /和是11/.test(out), id + " 交互不对：" + JSON.stringify(out));
    ok(`${id}：中文路径、中文文件名、中文输出、输入${id !== "cpp" ? "、提示马上显示" : ""}`);
  }
  const bad = path.join(ws, "错.c"); fs.writeFileSync(bad, "#include <stdio.h>\nint main(){\n  int n\n  printf(\"%d\", n);\n}\n");
  const br = await runOnce("c", bad, opt, "");
  // 少分号：编译器报在第 4 行，其实是第 3 行「int n」后面少了 —— 要标到第 3 行、算出改法
  const semi = br.diags.find((d) => /分号/.test(d.hint || ""));
  assert.ok(br.compileFailed && semi && semi.line === 3 && semi.fix && semi.fix.line === 3 && semi.fix.text === ";", "报错不对：" + JSON.stringify(br));
  assert.ok(!/fix-it:/.test(br.stderr), "给机器读的 fix-it 行不该显示出来");
  ok("编译器报错是英文、能解析到行、标到真正少分号的那一行、算出改法");
  if (process.env.LC_TEST_AI) {
    const exe = path.join(RES, "llama", process.platform === "win32" ? "llama-server.exe" : "llama-server");
    const model = AI.findModel([path.join(RES, "models")]);
    assert.ok(fs.existsSync(exe), "没有 llama-server"); assert.ok(model, "没有模型文件");
    const child = await AI.startServer(exe, model, { timeoutMs: 240000 });
    const ans = await AI.chat([{ role: "user", content: "用一句中文说：C 语言里 printf 是做什么的？" }], null, { maxTokens: 60 });
    try { child && child.kill(); } catch (e) {}
    assert.ok(ans && ans.length > 4, "模型没回答");
    ok("本地模型能启动、能回答：" + ans.replace(/\s+/g, " ").slice(0, 60));
  }
  console.log("安装包自带的工具：全部通过");
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
