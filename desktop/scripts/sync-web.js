#!/usr/bin/env node
// 把网站的最新代码拷进电脑版：打包前自动运行（npm run sync-web；GitHub Actions 打包时也会跑）。
// 网站改了下面这些东西，电脑版重新打包就跟着变，不用手抄：
//   · 共用的规则：群消息整理（parse.js）、捞捞智能排序和问答（island-core.js）、服务器地址（config.js）
//   · 整块搬过来用的页面：课内学习、思维导图、云宠农场、元宇宙工具箱（外面包一层 WebShim，见 renderer/webshim.js）
//   · 内置工具：随机抽签器、错题记录本；标题字体；本科院校名单
// 用法：node scripts/sync-web.js [网站目录，默认是上一级]
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DESK = path.resolve(__dirname, "..");
const SITE = path.resolve(process.argv[2] || path.join(DESK, ".."));
const R = (...p) => path.join(DESK, "renderer", ...p);
const S = (...p) => path.join(SITE, ...p);
const must = (f) => { if (!fs.existsSync(f)) throw new Error("网站里找不到 " + path.relative(SITE, f)); return f; };
const read = (f) => fs.readFileSync(must(f), "utf8");
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); console.log("  写入", path.relative(DESK, f)); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(must(from), to); console.log("  复制", path.relative(DESK, to)); };

let ver = "";
try { ver = execSync("git log -1 --format=%h·%cd --date=short", { cwd: SITE }).toString().trim(); } catch (e) { ver = new Date().toISOString().slice(0, 10); }
const head = (src) => `// 由 desktop/scripts/sync-web.js 从网站的 ${src} 自动生成（网站版本 ${ver}），不要在这里改：改网站那份，再运行 npm run sync-web\n`;

console.log("从网站同步代码：", SITE);

// 1. 共用的规则和配置
copy(S("parse.js"), path.join(DESK, "core", "parse.js"));
copy(S("lao-train.js"), path.join(DESK, "core", "lao-train.js"));   // 6.8 闲时自学
copy(S("island-core.js"), path.join(DESK, "core", "island-core.js"));
copy(S("coach-core.js"), path.join(DESK, "core", "coach-core.js"));
copy(S("memo-core.js"), path.join(DESK, "core", "memo-core.js"));
copy(S("docx-text.js"), R("docx-text.js"));                            // 6.3 直接导入 Word 文档（和网页、小程序同一份）     // 6.2 备忘录：清单、重复、置顶、搜索（和网页、小程序同一份）   // 3.3.3 捞捞教练（和网页、小程序同一份）
copy(S("flow-ui.js"), R("flow-ui.js"));                                // 3.3.4 刷任务界面（和网页同一份）
copy(S("config.js"), path.join(DESK, "core", "site-config.js"));
copy(S("memo.js"), R("web", "memo.js"));   // 3.3：导入手机备忘录的拆分规则

// 2. 字体
copy(S("fonts.css"), R("fonts.css"));
for (const f of fs.readdirSync(must(S("fonts")))) copy(S("fonts", f), R("fonts", f));

// 3. 整块搬过来用的页面：外面包一层 with (WebShim.scope)，网站代码里的全局变量都换成电脑版的
// exports：这个文件里顶层定义的函数，电脑版要调用的（study / mindmap 自己挂在 window 上，不用列）
const MODS = [
  { src: "study.js", out: "study.js", css: "study.css" },
  { src: "farm.js", out: "farm.js", exports: ["renderFarm", "farmNumbers", "farmState", "farmSave", "farmReload", "farmFeed", "farmPick", "farmRename", "petSVG", "petCfg", "petStage", "farmOn", "farmMini", "farmCard"] },
  { src: "metaverse-v3.js", out: "metalab.js", css: "metaverse-v3.css" },
];
for (const m of MODS) {
  const code = read(S(m.src));
  // 不用改原代码：文件顶层的 "use strict" 放进 with 块里只是一句普通的字符串，不起作用也不报错；函数里面的照常生效
  const exp = (m.exports || []).map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(", ");
  write(R("web", m.out), head(m.src) + "(function () { with (WebShim.scope) {\n" + code + (exp ? `\n;WebShim.put(${JSON.stringify(m.src.replace(/\.js$/, ""))}, { ${exp} });` : "") + "\n} }).call(window);\n");
  if (m.css) write(R("web", m.css), head(m.css).replace(/^\/\/ /, "/* ").replace(/\n$/, " */\n") + read(S(m.css)));
}
// 云宠农场的样式写在网站 index.html 的 <style> 里：按注释把那一段切出来
{
  const html = read(S("index.html"));
  const a = html.indexOf("/* ===== 云宠农场");
  if (a < 0) throw new Error("index.html 里找不到「云宠农场」的样式（注释 /* ===== 云宠农场 … */）");
  const rest = html.slice(a + 10), b = rest.search(/\n\s*\/\* =====|<\/style>/);
  write(R("web", "farm.css"), head("index.html 里的云宠农场样式").replace(/^\/\/ /, "/* ").replace(/\n$/, " */\n") + html.slice(a, a + 10 + (b < 0 ? rest.length : b)) + "\n");
}

// 3.5 思维导图（6.5 换成「捞捞学习」里队友做的新版 learn/mindmap/）：整个页面拷过来，在 iframe 里跑，
//     账号和同步借电脑版这一层（v-web.js 代为调 mm_* 接口），所以去掉网页登录的那两行脚本
{
  const MM = S("learn", "mindmap"), OUT = R("web", "mindmap");
  fs.rmSync(OUT, { recursive: true, force: true });
  // 6.8 新版要本机服务：js/*.cjs 要带上（主进程 core/mm-server.js 用）；网页版专用的 sw.js、runtime/ 不要
  const skip = /^(tools|runtime|sw\.js|server\.js|package\.json|.*\.md|\.gitignore)$/;
  const walk = (rel) => {
    for (const f of fs.readdirSync(path.join(MM, rel))) {
      const r = rel ? rel + "/" + f : f;
      if (skip.test(r)) continue;
      if (fs.statSync(path.join(MM, r)).isDirectory()) walk(r);
      else if (r === "index.html") write(path.join(OUT, r), read(path.join(MM, r)).split("\n").filter((l) => !/data-web-only/.test(l)).join("\n"));
      else copy(path.join(MM, r), path.join(OUT, r));
    }
  };
  walk("");
  for (const old of ["mindmap.js", "mindmap.css"]) fs.rmSync(R("web", old), { force: true });
}

// 4. 内置工具（在隔离间里运行，和网站同一份）
for (const f of ["random-draw.html", "error-notebook.html", "tools.css", "vendor/pako_inflate.min.js", "vendor/PAKO-LICENSE.txt"]) copy(S("plugins", f), R("web", "tools", f));

// 工具的隔离间：和网站同一份（新版多了批量保存，内置工具要用）
copy(S("sandbox.html"), R("sandbox.html"));

// 5. 本科院校名单（注册、编辑资料时选学校）
const sch = JSON.parse(read(S("schools-2026.json")));
write(R("web", "schools.js"), head("schools-2026.json") + "window.CC_SCHOOLS = " + JSON.stringify(sch) + ";\n");

write(R("web", "VERSION.txt"), `网站版本 ${ver}\n同步时间 ${new Date().toISOString()}\n`);
console.log("好了。");
