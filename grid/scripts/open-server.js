// 打「捞捞算力 通用版 · 调度中心」压缩包：别人在自己的云服务器上搭训练网用
//   只放调度中心要的文件：server/（不含下载门口的国内 IP 表）、shared/、tools/grid.js、示例配方和示例计划、搭建说明
//   不放：捞捞的训练配方和训练计划、客户端、捞捞自己的部署脚本（下载门口、安装包中转、存储搬家）
//   用法：node scripts/open-server.js [输出文件]   （默认 dist-open/LaolaoGrid-Open-Server.zip）
"use strict";
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..");
const { KEEP_RECIPES } = require("./open");

const SERVER = ["index.js", "core.js", "cycle.js", "store.js", "dlgate.js", "dlrelay.js", "deploy.sh", "admin/**"];
const PLANS = ["demo.json", "cycle-demo.json"];

function list() {
  const out = [];
  const add = (rel) => { if (fs.existsSync(path.join(R, rel))) out.push(rel); };
  const walk = (rel) => { for (const f of fs.readdirSync(path.join(R, rel))) { const r = rel + "/" + f; if (fs.statSync(path.join(R, r)).isDirectory()) walk(r); else out.push(r); } };
  for (const f of SERVER) { if (f.endsWith("/**")) walk("server/" + f.slice(0, -3)); else add("server/" + f); }
  walk("shared");
  add("tools/grid.js");
  for (const f of KEEP_RECIPES) add("recipes/" + f);
  add("py/lg.py");
  for (const f of PLANS) add("plans/" + f);
  return out.filter((f) => !/__pycache__|\.pyc$/.test(f));
}

async function pack(outFile) {
  const JSZip = require("jszip");
  const z = new JSZip();
  const root = "laolao-grid/";
  for (const f of list()) z.file(root + f, fs.readFileSync(path.join(R, f)), f.endsWith(".sh") ? { unixPermissions: 0o755 } : {});
  z.file(root + "server/edition.json", JSON.stringify({ open: true }));
  z.file(root + "README.md", fs.readFileSync(path.join(__dirname, "open-server-README.md")));
  const buf = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { file: outFile, size: buf.length, files: list().length + 2 };
}

if (require.main === module) {
  pack(process.argv[2] || path.join(R, "dist-open", "LaolaoGrid-Open-Server.zip")).then((r) => console.log(`调度中心压缩包：${r.file}（${r.files} 个文件，${Math.round(r.size / 1024)}KB）`)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { list, pack };
