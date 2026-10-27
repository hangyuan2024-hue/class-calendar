#!/usr/bin/env node
// 捞捞学习 · 把课内仓库里的思维导图模块（courses_app/modules/mindmap）导入成网站用的 learn/mindmap/
//
// 网站上只放一份思维导图：
//   learn/mindmap/index.html     独立的「捞捞思维导图」（有导图库、自己的 AI 设置）
//   learn/mindmap/course.html    课内学习里「生成导图 / 编辑导图」嵌入的工作台
//   learn/mindmap/preview.html   课内学习资料详情里的只读预览
// 课内仓库里这个模块挂在本机服务的 /mindmap/ 下，地址写的是绝对路径 /mindmap/api/…、/mindmap/vendor/…；
// 这里统一改成相对路径（api/…、vendor/…）：网站上（/learn/mindmap/）和本机课内服务（/mindmap/）都能用。
// 另外加上网站版的几个文件：Service Worker 启动（web-boot.js）、旧浏览器补丁（pdf-polyfill.js）、旧版导图搬家（cloud-import.js）、账号同步（../learn-sync.js）。
//
// 用法（在网站根目录）：
//   node learn/runtime/import-mindmap.js --module <courses_app>/modules/mindmap --standalone <Laolao-mindmap 仓库>
//   --standalone 用来取独立版的 index.html（课内仓库里的 index.html 已经改成课程模式）；不给就沿用现在的 learn/mindmap/index.html 结构。
"use strict";
const fs = require("fs"), path = require("path");
const LEARN = path.resolve(__dirname, ".."), OUT = path.join(LEARN, "mindmap");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MOD = arg("--module"), STAND = arg("--standalone");
if (!MOD || !fs.existsSync(path.join(MOD, "course.html"))) throw new Error("用 --module 指定 courses_app/modules/mindmap 目录");

// 不复制：个人数据、密钥、依赖、本机启动脚本
const SKIP = /(^|[\\/])(\.local|storage|node_modules|\.git|lecture-tasks)([\\/]|$)|\.(lnk|cmd|bat|ps1)$/i;
const TEXT = /\.(js|mjs|cjs|html|css|json|md|txt)$/i;
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (SKIP.test(path.relative(MOD, s))) continue;
    if (/[^\x00-\x7f]/.test(e.name)) continue;   // 中文文件名（历史说明、PDF 手册）不放进网站：GitHub 网页上传压缩包时中文名会乱码
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function edit(file, fn) { const p = path.join(OUT, file), a = fs.readFileSync(p, "utf8"), b = fn(a); if (b !== a) fs.writeFileSync(p, b); }
function must(s, from, to, file) {
  // 课内仓库的文件有的是 Windows 换行（\r\n）：补丁里的换行跟着文件走
  if (!s.includes(from) && /\r\n/.test(s)) { from = from.replace(/\r?\n/g, "\r\n"); to = to.replace(/\r?\n/g, "\r\n"); }
  if (!s.includes(from)) throw new Error(`补丁没对上：${file} 里找不到「${from.slice(0, 70)}」`);
  return s.split(from).join(to);
}

// 没给 --standalone：保留现在的独立版首页（课内仓库里的 index.html 是课程模式的）
const keepIndex = !STAND && fs.existsSync(path.join(OUT, "index.html")) ? fs.readFileSync(path.join(OUT, "index.html")) : null;
copyDir(MOD, OUT);
if (keepIndex) fs.writeFileSync(path.join(OUT, "index.html"), keepIndex);

// ---------- 1. 绝对路径 /mindmap/… → 相对路径（浏览器端的脚本、页面、样式；.cjs 是服务端，用的是挂载后的 /api/…，不用改） ----------
let changed = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(OUT, p);
    if (e.isDirectory()) { if (!/^(vendor|docs|runtime)$/.test(rel)) walk(p); continue; }
    if (!/\.(js|html|css)$/.test(e.name)) continue;
    if (/^vendor[\\/]/.test(rel) && rel.replace(/\\/g, "/") !== "vendor/mindmap.js") continue;
    let s = fs.readFileSync(p, "utf8"); const a = s;
    // PDF.js 是 ES 模块：普通脚本里的 import("相对路径") 是相对脚本文件的，要换成相对页面的完整地址
    s = s.replace(/import\((['"])\/mindmap\/(vendor\/pdfjs\/[^'"]+)\1\)/g, "import(new URL($1$2$1,document.baseURI).href)");
    // PDF 后台线程先加载旧浏览器补丁（vendor/pdfjs/build/pdf.worker.poly.mjs）
    s = s.replace(/(['"])\/mindmap\/vendor\/pdfjs\/build\/pdf\.worker\.mjs\1/g, "$1vendor/pdfjs/build/pdf.worker.poly.mjs$1");
    // 附件草稿令牌：网页里请求地址是相对的 api/maps/…
    s = s.replace(/\/\^\\\/mindmap\\\/api\\\/maps\\\//g, "/^(?:\\/mindmap\\/)?api\\/maps\\/");
    s = s.split("/mindmap/api/").join("api/").split("/mindmap/vendor/").join("vendor/");
    if (s !== a) { fs.writeFileSync(p, s); changed++; }
  }
})(OUT);
// 编辑器核心 vendor/mindmap.js 是导图作者自己的代码（不是第三方库），里面也有 /mindmap/api/… 地址
(function () { const p = path.join(OUT, "vendor/mindmap.js"); let s = fs.readFileSync(p, "utf8"); const a = s;
  s = s.replace(/\/\^\\\/mindmap\\\/api\\\/maps\\\//g, "/^(?:\\/mindmap\\/)?api\\/maps\\/").split("/mindmap/api/").join("api/").split("/mindmap/vendor/").join("vendor/");
  if (s !== a) { fs.writeFileSync(p, s); changed++; } })();
console.log("改成相对路径的文件：", changed);
// 还剩绝对路径就报出来（需要人工看一下）
(function check(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(OUT, p);
    if (e.isDirectory()) { if (!/^(vendor|docs|runtime)$/.test(rel)) check(p); continue; }
    if (/\.(js|html|css)$/.test(e.name) && /['"`(]\/mindmap\//.test(fs.readFileSync(p, "utf8"))) console.warn("⚠ 还有 /mindmap/ 绝对路径：", rel);
  }
})(OUT);

// ---------- 2. 独立版首页 ----------
if (STAND) {
  let s = fs.readFileSync(path.join(STAND, "index.html"), "utf8");
  if (/course-host\.js/.test(s)) throw new Error("--standalone 的 index.html 是课程模式的，不对");
  fs.writeFileSync(path.join(OUT, "index.html"), s);
}
const WEB_HEAD = '  <script src="js/web-boot.js"></script>\n  <script src="js/pdf-polyfill.js"></script>\n';
edit("index.html", (s) => {
  if (s.includes("js/web-boot.js")) return s;
  s = must(s, "<title>捞捞思维导图（独立版）</title>", "<title>捞捞思维导图</title>", "index.html");
  s = must(s, '  <script src="js/workspace-state.js"></script>', '  <script src="../../config.js" data-web-only></script>\n  <script src="../../auth.js" data-web-only></script>\n' + WEB_HEAD + '  <script src="js/workspace-state.js"></script>', "index.html");
  s = must(s, "</body>", '  <script src="js/cloud-import.js"></script>\n  <script>window.LEARN_SYNC_CHIP_POS = "right";</script>\n  <script src="../learn-sync.js"></script>\n  <script>\n    // 从账号同步下来新的导图：还没打开导图时直接刷新列表\n    window.LearnSync && LearnSync.on(function (i) { if (!i.changedLocal) return; var cur = null; try { cur = window.Mindmap && Mindmap.state && Mindmap.state().cur; } catch (e) {} if (!cur) location.reload(); });\n  </script>\n</body>', "index.html");
  return s;
});
// 课内嵌入的两个页面：在 iframe 里，Service Worker 已经由外面的课内学习页面装好；只加旧浏览器补丁和网页版启动
for (const f of ["course.html", "preview.html"]) edit(f, (s) => s.includes("js/web-boot.js") ? s : must(s, '<link rel="stylesheet" href="css/course-host.css">', '<link rel="stylesheet" href="css/course-host.css">\n' + WEB_HEAD.trim().replace(/\n\s*/g, "\n"), f));

// 网页版：课内学习在网站上用平台 AI（没有自己的 Key），导图要用自己的「大模型 API 接入」（和独立版共用一份配置）。
// 所以课程模式的工作台也加载 ai-settings.js，course-host.js 在网页版不把设置按钮转到课程顶栏。
edit("course.html", (s) => s.includes("js/ai-settings.js") ? s : must(s, '  <script src="js/editor-format.js"></script>\n', '  <script src="js/editor-format.js"></script>\n  <script src="js/ai-settings.js"></script>\n', "course.html"));
edit("js/course-host.js", (s) => {
  if (s.includes("MM_WEB")) return s;
  s = must(s, "  const settings=document.getElementById('mmAPISettingsButton');", "  if(!window.MM_WEB){ // 网页版：用导图自己的 API 接入（js/ai-settings.js）\n  const settings=document.getElementById('mmAPISettingsButton');", "js/course-host.js");
  s = s.replace(/(settingsDialog\.id='mmAPISettingsDialog';[^\n]*\n)/, (m) => m + "  }" + (/\r\n/.test(m) ? "\r\n" : "\n"));
  s = must(s, "  if(!event.target.closest('#mmAPISettingsButton,#mmOutlineSettings'))return;", "  if(window.MM_WEB || !event.target.closest('#mmAPISettingsButton,#mmOutlineSettings'))return;", "js/course-host.js");
  return s;
});

// 网页版的后台任务在本浏览器的 Service Worker 里跑：关掉所有页面后浏览器会停掉它（再打开可以在「后台任务」里继续），提示改一下
const WEB_KEEP = "网页版在本浏览器里处理：生成完成前请保持这个页面打开（中途关掉的，可以在「后台任务」里继续）。";
edit("js/ai-outline.js", (s) => s.includes("MM_WEB") ? s : must(s, "提交后台后可以关闭网页，本地服务需保持运行。", "${window.MM_WEB?'" + WEB_KEEP + "':'提交后台后可以关闭网页，本地服务需保持运行。'}", "js/ai-outline.js"));
edit("js/lecture-task-ui.js", (s) => {
  if (s.includes("MM_WEB")) return s;
  s = must(s, "status('已提交本地后台任务。可以切换或关闭网页；请保持本地服务运行。')", "status(window.MM_WEB?'已提交后台任务。" + WEB_KEEP + "':'已提交本地后台任务。可以切换或关闭网页；请保持本地服务运行。')", "js/lecture-task-ui.js");
  s = s.replace(/status\('已提交本地后台。识别稿、规划与生成进度会独立保存，可关闭网页。([^']*)'\)/, (m, rest) => "status(window.MM_WEB?'已提交后台任务。识别稿、规划与生成进度会独立保存。" + WEB_KEEP + "':'已提交本地后台。识别稿、规划与生成进度会独立保存，可关闭网页。" + rest + "')");
  return s;
});

// 课内源码放在 learn/courses_app/（不再带 modules/mindmap，本机课内服务直接挂这里的 learn/mindmap/）：课程共用 AI 设置的位置跟着改
edit("js/course-settings.cjs", (s) => s.includes("courses_app/back") ? s : must(s, "require('../../../back/localAiSettings')", "require('../../courses_app/back/localAiSettings')", "js/course-settings.cjs"));

// ---------- 3. 网站版自己的文件（课内仓库里没有，保留） ----------
for (const f of ["js/web-boot.js", "js/pdf-polyfill.js", "js/cloud-import.js", "vendor/pdfjs/build/pdf.worker.poly.mjs", "sw.js"]) {
  if (!fs.existsSync(path.join(OUT, f))) throw new Error("缺少网站版文件：learn/mindmap/" + f);
}
fs.writeFileSync(path.join(OUT, "VERSION.txt"), `思维导图模块：courses_app/modules/mindmap（${new Date().toISOString().slice(0, 10)} 导入，改成相对路径并加了网站版启动，见 learn/runtime/import-mindmap.js）\n`);
console.log("已导入思维导图到 learn/mindmap/");
