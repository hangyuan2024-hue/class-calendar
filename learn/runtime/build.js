#!/usr/bin/env node
// 捞捞学习 · 网页版打包脚本
//   1) 把「课内」的前端（learn/courses_app/fronted）复制到 learn/courses/，打上网站版的补丁（接口地址、账号同步、云端识别……）
//   2) 把课内后端（back/server.js）和思维导图的本机服务（learn/mindmap/js/*.cjs）一起打成 learn/sw.js
// 用法（在网站根目录）：
//   node learn/runtime/build.js                                      # 7.5 课内源码已经放在本仓库 learn/courses_app/：重新复制前端 + 打包
//   node learn/runtime/build.js --courses <别的 courses_app 目录>      # 用别处的课内源码
//   node learn/runtime/build.js --sw-only                            # 只重新打包 sw.js（用上次复制好的后端源码）
// 需要 esbuild：环境变量 ESBUILD 指向 esbuild 可执行文件，或者 PATH 里有 esbuild。
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const LEARN = path.resolve(__dirname, ".."), RT = __dirname;
const OUT = path.join(LEARN, "courses");
const SERVER_SRC = path.join(RT, "courses-server");      // 课内后端源码（打过补丁的副本，只用来打包，不会被网页加载）
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const COURSES = process.argv.includes("--sw-only") ? null : arg("--courses") || path.join(LEARN, "courses_app");
const ESBUILD = process.env.ESBUILD || "esbuild";
const V = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-learn5";

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (skip && skip(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}
// 打补丁：找不到要替换的原文就报错（课内仓库改了这一段，需要人工看一下补丁还对不对）
function patch(file, pairs) {
  let s = fs.readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    if (from instanceof RegExp) { if (!from.test(s)) throw new Error(`补丁没对上：${path.relative(LEARN, file)} 里找不到 ${from}`); s = s.replace(from, to); }
    else { if (!s.includes(from)) throw new Error(`补丁没对上：${path.relative(LEARN, file)} 里找不到「${from.slice(0, 60)}」`); s = s.split(from).join(to); }
  }
  fs.writeFileSync(file, s);
}

if (COURSES) {
  const back = path.join(COURSES, "back"), front = path.join(COURSES, "fronted");
  if (!fs.existsSync(path.join(back, "server.js")) || !fs.existsSync(path.join(front, "index.html"))) throw new Error("找不到 courses_app 的 back/server.js 或 fronted/index.html：" + COURSES);
  const rev = path.resolve(COURSES) === path.join(LEARN, "courses_app") ? "learn/courses_app" : (() => { try { return "courses_app " + cp.execSync("git rev-parse --short HEAD", { cwd: COURSES }).toString().trim(); } catch (e) { return "courses_app ?"; } })();

  // ---------- 后端源码 ----------
  rm(SERVER_SRC);
  copyDir(back, SERVER_SRC, (s, e) => /(^|[\\/])(node_modules|uploads|data|\.env.*|officePreview|ocr)$/.test(s) || /localAiGateway\.js$/.test(s) || /\.(db|log)$/.test(e.name));
  patch(path.join(SERVER_SRC, "server.js"), [
    ["require('./ocr/service')", "require('../stubs/ocrService.js')"],
    ["require('./localAiGateway')", "require('../stubs/localAiGateway.js')"],
    ["require('./officePreview')", "require('../stubs/officePreview.js')"],
    [/const handoffs = new Map\(\);[^\n]*/, "const handoffs = require('../stubs/handoffs.js'); // 网页版：存进虚拟磁盘（Service Worker 会被浏览器随时停掉）"],
    // 7.5 本机版把思维导图模块挂在 /mindmap/；网站上导图在 learn/mindmap/，由 learn/sw.js 的 mindmap-part.js 提供接口
    ["require('./mindmapService')", "require('../stubs/mindmapService.js')"],
  ]);
  // 建表 / 升级：本机版 require 时跑一遍；网页版从账号下载了别的设备的数据库后还要再跑，所以收进一个函数。网站上不放演示课程
  {
    const f = path.join(SERVER_SRC, "db/schema.js");
    let s = fs.readFileSync(f, "utf8");
    const calls = [];
    s = s.replace(/^(migrate[A-Za-z0-9]*)\(\);[ \t]*$/gm, (m, name) => { calls.push(name); return "// " + m + "（网页版：移到文件末尾的 __runAll）"; });
    if (calls.length < 5 || calls[0] !== "migrate") throw new Error("补丁没对上：db/schema.js 的建表调用和预想的不一样");
    if (/module\.exports/.test(s)) throw new Error("补丁没对上：db/schema.js 已经有 module.exports");
    s += `\n// 网页版：按原来的顺序依次执行\nfunction __runAll() {\n${calls.map((c) => "  " + c + "();").join("\n")}\n}\n__runAll();\nmodule.exports = { __runAll };\n`;
    fs.writeFileSync(f, s);
    patch(f, [[/(function seedCourses\(\) \{)/, "$1\n  return; // 网页版：不放演示课程"]]);
  }
  fs.appendFileSync(path.join(SERVER_SRC, "server.js"), "\n// 网页版：Service Worker 直接调用 app（runtime/courses-part.js）\nmodule.exports = app;\n");
  fs.writeFileSync(path.join(SERVER_SRC, "VERSION.txt"), `${rev}（${new Date().toISOString().slice(0, 10)} 复制，已打网页版补丁，见 learn/runtime/build.js）\n`);

  // ---------- 前端 ----------
  const keep = {};
  for (const k of ["vendor/sqljs", "vendor/office"]) { const p = path.join(OUT, k); if (fs.existsSync(p)) { keep[k] = path.join(os.tmpdir(), "learn-keep-" + k.replace("/", "-")); rm(keep[k]); copyDir(p, keep[k]); } }
  rm(OUT);
  copyDir(front, OUT, (s, e) => /\.lnk$/.test(e.name) || e.name === "ocr-check.html" || /[\\/]vendor[\\/]ocr$/.test(s));
  for (const [k, tmp] of Object.entries(keep)) { copyDir(tmp, path.join(OUT, k)); rm(tmp); }
  for (const f of ["site-pre.js", "site-bridge.js", "office-preview.js", "theme.js", "site.css"]) fs.copyFileSync(path.join(RT, "courses-site", f), path.join(OUT, f));
  if (!fs.existsSync(path.join(OUT, "vendor/sqljs/sql-wasm.wasm")) || !fs.existsSync(path.join(OUT, "vendor/office/fflate.min.js"))) {
    copyDir(path.join(RT, "courses-site", "vendor"), path.join(OUT, "vendor"));
  }
  patch(path.join(OUT, "index.html"), [
    ["<h1>课内</h1>", "<h1>课内学习</h1>"],
    [/<title>[^<]*<\/title>/, "<title>课内学习 · 捞捞学习</title>\n  <link rel=\"icon\" href=\"../../favicon.svg\" type=\"image/svg+xml\">"],
    [/(<link rel="stylesheet" href="style\.css[^"]*" \/>)/, `$1\n  <link rel="stylesheet" href="site.css?v=${V}" />\n  <script src="../../config.js"></script>\n  <script src="../../auth.js"></script>\n  <script src="site-pre.js?v=${V}"></script>`],
    ['<script src="app.js"></script>', `<script src="site-bridge.js?v=${V}"></script>\n  <script src="office-preview.js?v=${V}"></script>\n  <script src="../learn-sync.js?v=${V}"></script>\n  <script src="app.js"></script>`],
  ]);
  // 7.5 导图模块：本机版在 /mindmap/，网站上在 learn/mindmap/（课内学习页面是 learn/courses/）
  patch(path.join(OUT, "index.html"), [[/(["'])\/mindmap\//g, "$1../mindmap/"]]);
  patch(path.join(OUT, "js/mindmapEmbed.js"), [[/'\/mindmap\/(preview|course)\.html/g, "'../mindmap/$1.html"]]);
  patch(path.join(OUT, "js/outlineMap.js"), [["const MINDMAP_APP_URL = '/mindmap/';", "const MINDMAP_APP_URL = '../mindmap/';"]]);
  // 网站上课内学习用平台 AI，导图工作台用导图自己的「大模型 API 接入」（和独立版共用）
  patch(path.join(OUT, "js/mindmapEmbed.js"), [["AI 与课程顶栏共用设置。", "导图的 AI 用工作台顶栏的「大模型 API 接入」（和思维导图共用）。"]]);
  // 后端不在 3000 端口：自检横条里「连不上后端」的说法改成网页版的
  patch(path.join(OUT, "index.html"), [["banner('✗ 连不上后端：请在 back 目录执行 npm start，确认 3000 端口在跑。');", "banner('✗ 课内学习的本地服务没启动：请刷新页面；无痕模式或禁用了网站数据时用不了。');"]]);
  patch(path.join(OUT, "js/ai.js"), [
    [/LOCAL_AI_UNAVAILABLE: '[^']*'/, "LOCAL_AI_UNAVAILABLE: 'AI 服务暂时连不上，请稍后再试。', AI_LOGIN_REQUIRED: '网站版的 AI 要先登录捞捞账号（左下角「点此登录」）。', AI_RATE_LIMITED: 'AI 用得太频繁了，或者今天的平台 AI 次数用完了；可以稍后再试，或在 AI 设置里填自己的 Key。', AI_SERVICE_UNAVAILABLE: 'AI 服务暂时用不了，请稍后再试。', AI_SERVICE_NOT_DEPLOYED: '网站的 AI 服务还没部署好，请联系管理员。', AI_SERVICE_AUTH: '网站的 AI 服务口令失效了，请联系管理员。'"],
    [/AI_LOCAL_ONLY: '[^']*'/, "AI_LOCAL_ONLY: 'AI 服务暂时连不上，请稍后再试。'"],
    [/AI_API_NOT_CONFIGURED: '[^']*'/, "AI_API_NOT_CONFIGURED: 'AI 服务暂时连不上，请稍后再试。'"],
  ]);
  patch(path.join(OUT, "js/assessmentCharts.js"), [[/LOCAL_AI_UNAVAILABLE: '[^']*'/, "LOCAL_AI_UNAVAILABLE: 'AI 服务暂时连不上，可以先手动填写图表数据。'"]]);
  patch(path.join(OUT, "js/attachmentPreview.js"), [[/CONVERTER_UNAVAILABLE:'[^']*'/, "CONVERTER_UNAVAILABLE:'网站版暂不支持在线预览 Word / PPT，请点「下载附件」查看；文字内容可以在正文里查看。'"]]);
  patch(path.join(OUT, "js/officeText.js"), [[/hint: \(legacy \? '[^']*' : ''\)/, "hint: (legacy ? '网站版不能转换旧版 .doc / .ppt，请另存为 .docx / .pptx 后再试。' : '')"]]);
  // 跟着网站外观换色：样式里的颜色换成变量，生成 theme.css（见 theme-gen.js）
  {
    const tg = require("./theme-gen.js");
    const r = tg.tokenize(fs.readFileSync(path.join(OUT, "style.css"), "utf8"));
    fs.writeFileSync(path.join(OUT, "style.css"), r.css);
    fs.writeFileSync(path.join(OUT, "theme.css"), tg.themeCss(r.colors));
    patch(path.join(OUT, "index.html"), [[/(<link rel="stylesheet" href="style\.css[^"]*" \/>)/, `<script src="theme.js?v=${V}"></script>\n  $1\n  <link rel="stylesheet" href="theme.css?v=${V}" />`]]);
    console.log("外观：", r.colors.length, "种颜色换成了变量");
  }
  fs.writeFileSync(path.join(OUT, "VERSION.txt"), `${rev}（前端，${new Date().toISOString().slice(0, 10)} 复制，网页版补丁见 learn/runtime/build.js）\n`);
  console.log("已复制课内前端和后端源码：", rev);
}

// ---------- 打包 learn/sw.js ----------
if (!fs.existsSync(path.join(SERVER_SRC, "server.js"))) throw new Error("还没有课内后端源码：先运行一次  node learn/runtime/build.js --courses <courses_app 目录>");
// 思维导图的提示词模板（本机版从 prompts/*.md 读文件）
const prompts = {};
for (const f of fs.readdirSync(path.join(LEARN, "mindmap/prompts"))) if (f.endsWith(".md")) prompts["/app/prompts/" + f] = fs.readFileSync(path.join(LEARN, "mindmap/prompts", f), "utf8");
fs.writeFileSync(path.join(RT, "prompts-data.js"), "// 打包时生成（learn/runtime/build.js）\nmodule.exports=" + JSON.stringify(prompts) + ";\n");
fs.writeFileSync(path.join(RT, "server-app.js"), "// 打包入口：课内后端的 Express app\nmodule.exports = require(\"./courses-server/server.js\");\n");
// 7.5 思维导图「文字 / 图片生成导图」的后台任务：本机版 fork 一个 Node 子进程跑 text-worker.cjs；
// 网页版把它包成一个函数（子进程的 process 换成参数），由 stubs/child_process.js 的 fork 在同一个 Service Worker 里运行
{
  const W = { "text-worker.cjs": path.join(LEARN, "mindmap/js/text-worker.cjs") };
  let out = "// 打包时生成（learn/runtime/build.js）：思维导图后台任务，网页版在 Service Worker 里运行\n\"use strict\";\nmodule.exports = {\n";
  for (const [name, file] of Object.entries(W)) {
    let src = fs.readFileSync(file, "utf8").replace(/^\uFEFF?\s*(['"])use strict\1;?/, "");
    const n0 = (src.match(/\bprocess\./g) || []).length;
    src = src.replace(/\bprocess\./g, "__wp.")
      .replace(/require\((['"])\.\/([^'"]+)\1\)/g, (m, q, f) => "require(" + q + "../mindmap/js/" + f + q + ")")
      .replace(/require\((['"])@napi-rs\/canvas\1\)/g, "require(\"./napi-canvas.js\")")
      .replace(/\bc\.toBuffer\(/g, "await c.toBuffer(");   // 浏览器里编码图片是异步的
    if (!n0 || !/__wp\.on\('message'/.test(src)) throw new Error("补丁没对上：" + name + " 的写法和预想的不一样");
    out += "  " + JSON.stringify(name) + ": function (__wp) {\n" + src + "\n},\n";
  }
  fs.writeFileSync(path.join(RT, "workers-gen.js"), out + "};\n");
}
const A = (k, v) => [`--alias:${k}=./runtime/${v}`, `--alias:node:${k}=./runtime/${v}`];
const args = ["runtime/sw-entry.js", "--bundle", "--format=iife", "--platform=browser", "--target=chrome90,safari15",
  ...A("fs", "memfs.js"), ...A("fs/promises", "fs-promises.js"), ...A("path", "path.js"), ...A("crypto", "crypto.js"),
  ...A("os", "stubs/os.js"), ...A("url", "stubs/url.js"), ...A("child_process", "stubs/child_process.js"),
  "--alias:node:sqlite=./runtime/sqlite.js", "--alias:express=./runtime/express.js", "--alias:multer=./runtime/multer.js", "--alias:cors=./runtime/stubs/cors.js",
  "--external:../../courses_app/back/localAiSettings",   // 导图模块的 course-settings.cjs（读本机课内的共用 AI 设置），网页版不用
  "--inject:./runtime/inject.js", "--define:__dirname=\"/app/back\"", "--legal-comments=none", "--log-level=warning", "--outfile=sw.js"];
cp.execFileSync(ESBUILD, args, { cwd: LEARN, stdio: "inherit" });
console.log("已生成 learn/sw.js", (fs.statSync(path.join(LEARN, "sw.js")).size / 1024).toFixed(0) + "KB");
