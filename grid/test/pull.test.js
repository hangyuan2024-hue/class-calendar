// 签名包自己拉最新的训练计划和配方（tools/grid.js pull）：调度中心列出要签的那几份 → 每份和 GitHub 上的核对（不一样就不签）→ 列出新增 / 改了 / 没变 → 确认了才写进签名包、签名上传
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Server = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-pull-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ROOT = path.join(__dirname, "..");
const ok = (m) => console.log("✓", m);

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const c = await Tools.login(`http://127.0.0.1:${port}`, app.core.adminToken());
  // 签名包里是旧的：qa.json 改过、ppt.json 还没有
  const pack = path.join(tmp, "pack");
  fs.mkdirSync(path.join(pack, "plans"), { recursive: true }); fs.mkdirSync(path.join(pack, "recipes"), { recursive: true }); fs.mkdirSync(path.join(pack, "tools"), { recursive: true });
  fs.writeFileSync(path.join(pack, "plans", "qa.json"), "{\"old\":1}");
  fs.copyFileSync(path.join(ROOT, "plans", "chat.json"), path.join(pack, "plans", "chat.json"));
  const gh = (bad) => ({ fetch: async (u) => { const rel = /\/grid\/(.+)$/.exec(u)[1]; let t = fs.readFileSync(path.join(ROOT, rel), "utf8"); if (bad && rel === bad) t += "\n# 被人改过"; return { ok: true, text: async () => t }; } });
  const said = [];
  await assert.rejects(Tools.pull(c, { root: pack, yes: true, say: (m) => said.push(m), ...gh("recipes/qa_train.py") }), /调度中心的和 GitHub 上的不一样/);
  assert.equal(fs.readFileSync(path.join(pack, "plans", "qa.json"), "utf8"), "{\"old\":1}", "核对不过：一个字都不写");
  ok("调度中心给的和 GitHub 上的不一样：不签、签名包一个字都不改");

  said.length = 0;
  let q = null;
  const no = await Tools.pull(c, { root: pack, say: (m) => said.push(m), ask: async (x) => { q = x; return false; }, ...gh() });
  assert.ok(!no.signed && /确认就输入 y/.test(q));
  const line = (p) => said.find((l) => l.includes(p));
  assert.ok(/改了/.test(line("plans/qa.json")) && /新增/.test(line("plans/ppt.json")) && /没变/.test(line("plans/chat.json")) && line("recipes/ppt_gen.py") && line("recipes/vis_gen.py"), said.join("\n"));
  ok("列出来给你看：qa.json 改了、ppt.json 新增、chat.json 没变……（都和 GitHub 上核对过）；你不确认就不签");

  said.length = 0;
  const r = await Tools.pull(c, { root: pack, say: (m) => said.push(m), ask: async () => true, ...gh() });
  assert.ok(r.signed && r.ids.length === 7);
  assert.equal(fs.readFileSync(path.join(pack, "plans", "qa.json"), "utf8"), fs.readFileSync(path.join(ROOT, "plans", "qa.json"), "utf8"));
  const names = app.cycle.view().pipelines.map((p) => p.name);
  for (const n of ["答题数据工厂", "PPT 操作工厂", "看图反推工厂", "底座合并"]) assert.ok(names.includes(n), n + " 没设好：" + names);
  assert.ok(app.core.recipes().some((x) => x.name === "ppt_gen") && app.core.recipes().some((x) => x.name === "vis_gen"));
  ok("确认了：新的写进签名包、7 份训练计划和用到的配方全部签名上传");

  said.length = 0;
  const r2 = await Tools.pull(c, { root: pack, yes: true, noGithub: true, say: (m) => said.push(m) });
  assert.ok(r2.signed && said.some((l) => /没能和 GitHub 上的核对/.test(l)));
  ok("上不去 GitHub：照实提醒你只有确定调度中心刚 git pull 过才确认");
  app.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log("签名包自己拉最新配方：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
