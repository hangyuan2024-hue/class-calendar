// 捞捞算力 通用版：打包配置不带捞捞的训练配方和捞小智；调度中心压缩包只放搭建要用的文件、解压就能起来；
//   通用版客户端没有成品展示、查通用版的新版本；通用版调度中心不开下载门口、不搬捞捞的安装包
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const ok = (m) => console.log("✓", m);
const R = path.join(__dirname, "..");
const Open = require("../scripts/open");
const OpenServer = require("../scripts/open-server");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-open-"));
  // 1. 客户端打包配置
  const pkg = JSON.parse(fs.readFileSync(path.join(R, "package.json"), "utf8"));
  const b = Open.config(pkg);
  assert.ok(!b.files.includes("recipes/**"), "不能整个配方文件夹打进去");
  const recipes = b.files.filter((f) => f.startsWith("recipes/"));
  assert.deepEqual(recipes.map((f) => f.slice(8)).sort(), [...Open.KEEP_RECIPES].sort());
  for (const f of fs.readdirSync(path.join(R, "recipes")).filter((f) => f.endsWith(".py") && !Open.KEEP_RECIPES.includes(f))) assert.ok(!recipes.includes("recipes/" + f), f);
  assert.ok(b.files.includes("!app/show.js") && b.files.includes("!app/ppt/**") && b.files.includes("app/ppt/engine.js"));
  assert.equal(b.win.artifactName, "LaolaoGrid-Open-Setup.exe"); assert.notEqual(b.appId, pkg.build.appId); assert.equal(b.directories.output, "dist-open");
  assert.ok(pkg.build.files.includes("recipes/**"), "内部版的打包配置不动");
  ok(`通用版客户端：配方只带 ${Open.KEEP_RECIPES.length} 个示例（测显卡、接力、多台一起训、生成审核），不带捞小智；内部版的打包配置不变`);

  // 2. 通用版客户端：没有成品展示、查通用版的版本文件、单独的数据文件夹
  const { createService } = require("../app/service");
  const Updater = require("../app/updater");
  const mk = (edition) => createService({ user: path.join(tmp, "u-" + (edition.open ? "open" : "in")), version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, edition,
    showFactory: () => ({ shutdown() {}, state: async () => ({}) }), updaterOpt: { noTimer: true } });
  const so = mk({ open: true }), si = mk({ open: false });
  assert.equal(typeof so.H.showState, "undefined"); assert.equal(typeof si.H.showState, "function");
  assert.equal((await so.H.status()).edition, "open"); assert.equal((await si.H.status()).edition, "");
  assert.ok(Updater.OPEN_SOURCES.every((u) => /grid-open-version\.json$/.test(u)));
  assert.match(fs.readFileSync(path.join(R, "app", "main.js"), "utf8"), /LaolaoGridOpen/);
  ok("通用版客户端：没有成品展示，新版本查 grid-open-version.json，数据单独放；内部版照旧");
  for (const s of [so, si]) { try { await s.shutdown(); } catch (e) {} }

  // 3. 调度中心压缩包：只放搭建要用的
  const files = OpenServer.list();
  for (const bad of [/^server\/(dl-https|dl-relay|grid-cos|update|cos-move)\.sh$/, /china-ip/, /^app\//, /^worker\//, /^recipes\/(qa_|qv_|voice_|chat_)/, /^plans\/(qa|chat|voice|laolao|qv)/]) assert.ok(!files.some((f) => bad.test(f)), "压缩包里不该有：" + files.filter((f) => bad.test(f)).join(","));
  for (const p of files.filter((f) => f.startsWith("plans/"))) {
    const plan = fs.readFileSync(path.join(R, p), "utf8");
    for (const m of plan.matchAll(/"\.\.\/recipes\/([\w.]+)"/g)) assert.ok(files.includes("recipes/" + m[1]), `${p} 用到的 ${m[1]} 要在压缩包里`);
  }
  const zipFile = path.join(tmp, "server.zip");
  const r = await OpenServer.pack(zipFile);
  const JSZip = require("jszip");
  const z = await JSZip.loadAsync(fs.readFileSync(zipFile));
  const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
  assert.ok(names.includes("laolao-grid/server/edition.json") && names.includes("laolao-grid/README.md") && names.includes("laolao-grid/tools/grid.js"));
  const all = (await Promise.all(names.filter((n) => /\.(js|json|md|sh|py|html)$/.test(n)).map((n) => z.files[n].async("string")))).join("\n");
  assert.ok(!/43\.129\.244\.29|1518432293|GRID_COS_SECRET=\S/.test(all), "压缩包里不该有捞捞服务器的 IP、存储桶");
  ok(`调度中心压缩包：${names.length} 个文件（${Math.round(r.size / 1024)}KB），没有捞捞的训练配方、训练计划、部署脚本、服务器 IP 和存储桶`);

  // 4. 解压出来就能起：通用版不开下载门口
  const dir = path.join(tmp, "x");
  for (const n of names) { const f = path.join(dir, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await z.files[n].async("nodebuffer")); }
  const Server = require(path.join(dir, "laolao-grid", "server", "index.js"));
  const app = Server.create({ data: path.join(tmp, "data"), noTick: true });
  const port = await app.listen(0, "127.0.0.1"); const url = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(url + "/api/ping")).status, 200);
  assert.equal((await fetch(url + "/dl/grid/LaolaoGrid-Setup.exe")).status, 404, "通用版不开下载门口");
  assert.equal((await fetch(url + "/dl/models/manifest.json")).status, 200);
  assert.equal((await fetch(url + "/admin/")).status, 200);
  await app.close();
  ok("解压出来的调度中心能启动：接口、控制中心都在；下载门口关着（不帮捞捞发安装包）");
  console.log("通用版：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
