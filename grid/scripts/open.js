// 打包「捞捞算力 通用版」前运行（在 prepare.js 之后）：
//   1. 写 app/edition.json（{ open: true }）：客户端没有成品展示，新版本查 grid-open-version.json，数据放 LaolaoGridOpen
//   2. 照着 package.json 里内部版的打包配置，写一份通用版的（open-builder.json）：
//      · 不带捞捞的训练配方（只留测显卡的 probe_gpu.py 和 4 个示例 demo_*.py），训练计划本来就不在客户端里
//      · 不带成品展示「捞小智」的代码（捞小智另外有电脑版）
//   用法：node scripts/open.js && npx electron-builder --config open-builder.json --win nsis
//   只在打包机器上跑：写的两个文件打完就没用了（--clean 删掉）
"use strict";
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..");

const KEEP_RECIPES = ["probe_gpu.py", "demo_relay.py", "demo_diloco.py", "demo_avatar.py", "demo_cycle.py"];
// 通用版客户端用得到的共用代码（AI 引擎、下载、组件镜像）；别的（捞小智、改 PPT、模拟教务、检测报告）不带
const KEEP_PPT = ["engine.js", "workflows.js", "mirror.js", "installer.js", "dl.js"];
const DROP = ["app/show.js", "app/renderer/show.js", "app/renderer/checkup.js", "app/renderer/zhi3d.js", "app/renderer/deckview.js"];

function config(pkg) {
  const b = JSON.parse(JSON.stringify(pkg.build));
  b.appId = "cn.laolaokechengbiao.grid.open";
  b.productName = "捞捞算力 通用版";
  b.extraMetadata = { name: "laolao-grid-open", productName: "捞捞算力 通用版", description: "捞捞算力 通用版：几台电脑一起训练模型，一台停了下一台接着算（自己搭调度中心）" };
  b.directories = { ...(b.directories || {}), output: "dist-open" };
  b.win = { ...(b.win || {}), artifactName: "LaolaoGrid-Open-Setup.exe" };
  b.nsis = { ...(b.nsis || {}), shortcutName: "捞捞算力 通用版" };
  const files = [];
  for (const f of b.files) {
    if (f === "recipes/**") { for (const r of KEEP_RECIPES) files.push("recipes/" + r); continue; }
    files.push(f);
  }
  files.push("!app/ppt/**");
  for (const f of KEEP_PPT) files.push("app/ppt/" + f);
  for (const f of DROP) files.push("!" + f);
  files.push("!node_modules/sherpa-onnx*/**", "!app/kokoro.js", "!app/tts-worker.js", "!app/realvoice.js");   // 好听的声音只给捞小智用
  b.files = files;
  b.asarUnpack = (b.asarUnpack || []).map((f) => (f === "recipes/**" ? "recipes/*.py" : f));
  return b;
}

if (require.main === module) {
  const pkg = JSON.parse(fs.readFileSync(path.join(R, "package.json"), "utf8"));
  fs.writeFileSync(path.join(R, "app", "edition.json"), JSON.stringify({ open: true }));
  const b = config(pkg);
  fs.writeFileSync(path.join(R, "open-builder.json"), JSON.stringify(b, null, 2));
  console.log("通用版：app/edition.json、open-builder.json 写好了（配方只留 " + KEEP_RECIPES.join("、") + "）");
}
module.exports = { config, KEEP_RECIPES, KEEP_PPT, DROP };
